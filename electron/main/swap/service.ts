/**
 * 同网络兑换：询价、必要时授权 / 租能量，本机签名后广播，再上报 hash。
 */
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import type {
  NetworkRecord,
  SwapHistoryItem,
  SwapQuote,
  SwapQuoteInput,
  SwapSubmitInput,
  SwapSubmitResult,
  TokenRecord,
  TronEnergyFeeMode,
} from '@shared/types'
import { getBaseUrl } from '../backend/config'
import { asNumber, asRecord, asString } from '../backend/list'
import {
  broadcastEvmTx,
  estimateEvmGas,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
  waitForEvmReceipt,
} from '../chain/evm'
import {
  broadcastTronTx,
  createTronContractTx,
  encodeTrc20TransferParameter,
  fetchTronTxInfo,
  signTronTx,
  type TronUnsignedTx,
} from '../chain/tron'
import { getAccountRow } from '../db/repos/accountRepo'
import { getNetwork, getToken } from '../db/repos/catalogRepo'
import { toChecksumAddress } from '../derive/evm'
import { ENERGY_CATALOG_HINT, compareEnergyFees, sunToTrx } from '../energy/codec'
import { normalizeChainId } from '../rpc/endpoints'
import { estimateEnergyOrder } from '../energy/api'
import { rentEnergyAndWait } from '../energy/service'
import { invalidArg, notFound } from '../ipc/registry'
import { explorerUrlForNetwork, persistBroadcastedTx } from '../txLab/service'
import { parseDecimalToMinor, formatMinor } from '../util/amount'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import { fetchSwapPrice, fetchSwapQuote, listSwapOrders, submitSwapHash } from './api'
import {
  DEFAULT_SLIPPAGE_BPS,
  formatSwapFee,
  parseMinorAmount,
  parseSlippageBps,
  parseWei,
  swapChainIdOf,
  swapKindOf,
  tokenAddressForSwap,
} from './codec'

function requireCatalogUrl(): void {
  if (!getBaseUrl()) throw invalidArg(`请先在设置里填写目录站地址，兑换使用 ${ENERGY_CATALOG_HINT}`)
}

function requireNetwork(id: string): NetworkRecord {
  const network = getNetwork(id)
  if (!network) throw notFound('网络不存在，请先同步目录')
  return network
}

function requireSwapChain(network: NetworkRecord): { chainId: number; kind: 'evm' | 'tron' } {
  const chainId = swapChainIdOf(network)
  if (chainId == null) {
    throw invalidArg('当前网络不支持应用内兑换。EVM 仅 Ethereum / BSC / Arbitrum，波场仅主网')
  }
  return { chainId, kind: swapKindOf(chainId) }
}

function requireTokenRow(id: string): TokenRecord {
  const token = getToken(id)
  if (!token) throw notFound('代币不存在，请先同步目录')
  return token
}

function requireAccountRow(id: string) {
  const row = getAccountRow(id)
  if (!row) throw notFound('付款账户不存在')
  return row
}

async function withAccountPrivateKeyAsync<T>(
  account: ReturnType<typeof requireAccountRow>,
  fn: (privateKey: Uint8Array) => Promise<T>,
): Promise<T> {
  return withAccountPrivateKey(account, (privateKey) => {
    const copy = Uint8Array.from(privateKey)
    return fn(copy).finally(() => copy.fill(0))
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function quoteSwap(input: SwapQuoteInput): Promise<SwapQuote> {
  requireCatalogUrl()
  const network = requireNetwork(input.networkPk)
  const { chainId, kind } = requireSwapChain(network)
  const account = getAccount(input.accountId)
  if (account.walletType !== network.walletType) throw invalidArg('付款账户与所选网络不匹配')
  const sellToken = requireTokenRow(input.sellTokenPk)
  const buyToken = requireTokenRow(input.buyTokenPk)
  if (sellToken.networkPk !== network.id || buyToken.networkPk !== network.id) {
    throw invalidArg('买卖代币必须属于当前网络')
  }
  const sellAddress = tokenAddressForSwap({ kind, isToken: sellToken.isToken, contractAddress: sellToken.contractAddress })
  const buyAddress = tokenAddressForSwap({ kind, isToken: buyToken.isToken, contractAddress: buyToken.contractAddress })
  if (sellAddress.toLowerCase() === buyAddress.toLowerCase()) throw invalidArg('卖出代币和买入代币不能相同')
  const sellAmountMinor = parseDecimalToMinor(input.sellAmount, sellToken.decimals)
  if (sellAmountMinor <= 0n) throw invalidArg('兑换数量必须大于 0')
  const slippageBps = parseSlippageBps(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS)
  const price = await fetchSwapPrice(kind, {
    chainId,
    sellToken: sellAddress,
    buyToken: buyAddress,
    sellAmount: sellAmountMinor.toString(),
    taker: account.address,
    slippageBps,
  })
  parseMinorAmount(price.buyAmount)
  const warnings = [...price.warnings]
  let energy: SwapQuote['energy'] = null
  if (kind === 'tron' && price.energyNeeded && price.energyQuantity > 0) {
    energy = await resolveSwapEnergy(price.energyQuantity, price.burnIfNoRentSun)
    if (!energy.rentTrx) warnings.push('暂时无法租赁能量，将只能燃烧 TRX')
  }
  const nativeDecimals = kind === 'tron' ? 6 : 18
  return {
    kind,
    chainId,
    sellSymbol: sellToken.symbol,
    buySymbol: buyToken.symbol,
    sellAmount: formatMinor(sellAmountMinor, sellToken.decimals),
    buyAmount: formatMinor(BigInt(price.buyAmount), buyToken.decimals),
    minBuyAmount: formatMinor(BigInt(price.minBuyAmount || price.buyAmount), buyToken.decimals),
    sellAmountMinor: sellAmountMinor.toString(),
    buyAmountMinor: price.buyAmount,
    feeText: formatSwapFee(price.networkFeeWei, nativeDecimals, price.nativeSymbol),
    allowanceNeeded: price.allowanceNeeded,
    allowanceTarget: price.allowanceTarget,
    energy,
    warnings,
  }
}

async function resolveSwapEnergy(quantity: number, burnIfNoRentSun: string | null): Promise<NonNullable<SwapQuote['energy']>> {
  const burnSun = burnIfNoRentSun ? parseWei(burnIfNoRentSun) : 0n
  let rentTrx: string | null = null
  let saveTrx = ''
  let cheaper: TronEnergyFeeMode | 'same' | null = null
  try {
    const quote = await estimateEnergyOrder(quantity, '1h')
    rentTrx = sunToTrx(quote.priceSun)
    if (burnSun > 0n) {
      cheaper = compareEnergyFees(quote.priceSun, burnSun)
      if (cheaper !== 'same') {
        saveTrx = sunToTrx(quote.priceSun > burnSun ? quote.priceSun - burnSun : burnSun - quote.priceSun)
      }
    }
  } catch {
    rentTrx = null
  }
  return {
    needed: true,
    quantity,
    duration: '1h',
    burnTrx: burnSun > 0n ? sunToTrx(burnSun) : '',
    rentTrx,
    saveTrx,
    cheaper,
  }
}

export async function submitSwap(input: SwapSubmitInput): Promise<SwapSubmitResult> {
  requireCatalogUrl()
  const network = requireNetwork(input.networkPk)
  const { chainId, kind } = requireSwapChain(network)
  const account = getAccount(input.accountId)
  const accountRow = requireAccountRow(input.accountId)
  if (account.walletType !== network.walletType) throw invalidArg('付款账户与所选网络不匹配')
  const sellToken = requireTokenRow(input.sellTokenPk)
  const buyToken = requireTokenRow(input.buyTokenPk)
  const sellAddress = tokenAddressForSwap({ kind, isToken: sellToken.isToken, contractAddress: sellToken.contractAddress })
  const buyAddress = tokenAddressForSwap({ kind, isToken: buyToken.isToken, contractAddress: buyToken.contractAddress })
  const sellAmountMinor = parseDecimalToMinor(input.sellAmount, sellToken.decimals)
  const slippageBps = parseSlippageBps(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS)
  const price = await fetchSwapPrice(kind, {
    chainId,
    sellToken: sellAddress,
    buyToken: buyAddress,
    sellAmount: sellAmountMinor.toString(),
    taker: account.address,
    slippageBps,
  })

  if (kind === 'tron' && price.energyNeeded && input.energyFeeMode === 'rent') {
    if (price.energyQuantity <= 0) throw invalidArg('当前能量已足够，无需租赁')
    await rentEnergyAndWait({
      accountId: account.id,
      networkPk: network.id,
      quantity: price.energyQuantity,
      duration: '1h',
    })
  }

  const quote = await fetchSwapQuote(kind, {
    chainId,
    sellToken: sellAddress,
    buyToken: buyAddress,
    sellAmount: sellAmountMinor.toString(),
    taker: account.address,
    slippageBps,
  })

  let approveTxid: string | null = null
  if (quote.allowanceNeeded && quote.allowanceTarget && sellToken.isToken && sellToken.contractAddress) {
    approveTxid =
      kind === 'evm'
        ? await approveEvm(network, accountRow, account.address, sellToken.contractAddress, quote.allowanceTarget, sellAmountMinor)
        : await approveTron(network, accountRow, account.address, sellToken.contractAddress, quote.allowanceTarget, sellAmountMinor)
  }

  const txid =
    kind === 'evm'
      ? await sendEvmSwap(network, accountRow, account.address, quote.transaction)
      : await sendTronSwap(network, accountRow, quote.transaction)

  const hashForBackend = kind === 'evm' ? (txid.startsWith('0x') ? txid : `0x${txid}`) : txid.replace(/^0x/i, '').toLowerCase()
  await submitSwapHash(kind, { quoteId: quote.quoteId, txHash: hashForBackend, taker: account.address })

  persistBroadcastedTx({
    network,
    accountId: account.id,
    from: account.address,
    to: quote.allowanceTarget || account.address,
    tokenPk: sellToken.id,
    symbol: sellToken.symbol,
    amount: formatMinor(sellAmountMinor, sellToken.decimals),
    fee: null,
    txid,
    raw: '',
    direction: 'send',
  })
  persistBroadcastedTx({
    network,
    accountId: account.id,
    from: quote.allowanceTarget || account.address,
    to: account.address,
    tokenPk: buyToken.id,
    symbol: buyToken.symbol,
    amount: formatMinor(BigInt(quote.buyAmount || '0'), buyToken.decimals),
    fee: null,
    txid,
    raw: '',
    direction: 'receive',
  })

  return {
    quoteId: quote.quoteId,
    txid,
    approveTxid,
    explorerUrl: explorerUrlForNetwork(network, txid),
  }
}

export async function listAccountSwaps(accountId: string, networkPk: string): Promise<SwapHistoryItem[]> {
  requireCatalogUrl()
  const network = requireNetwork(networkPk)
  const { chainId, kind } = requireSwapChain(network)
  const account = getAccount(accountId)
  const rows = await listSwapOrders(kind, account.address, chainId)
  if (kind !== 'tron') return rows
  return Promise.all(rows.map((row) => confirmTronSwapRow(row, network.networkScope)))
}

async function confirmTronSwapRow(
  row: SwapHistoryItem,
  networkScope: NetworkRecord['networkScope'],
): Promise<SwapHistoryItem> {
  if (!row.txHash) return row
  const current = row.status.trim().toUpperCase()
  if (current === 'FILLED' || current === 'SUCCESS' || current === 'FAILED') return row
  try {
    const info = asRecord(await fetchTronTxInfo(row.txHash, networkScope))
    if (!info) return row
    const receipt = asRecord(info.receipt)
    const result = asString(receipt?.result || info.result || info.contractRet)
    if (/REVERT|FAILED/i.test(result)) return { ...row, status: 'FAILED' }
    if (/SUCCESS/i.test(result) || asNumber(info.blockNumber, 0) > 0) return { ...row, status: 'FILLED' }
  } catch {
    /* 目录状态保持 SUBMITTED */
  }
  return row
}

async function approveEvm(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  token: string,
  spender: string,
  amount: bigint,
): Promise<string> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [toChecksumAddress(spender) as Hex, amount],
  })
  const txid = await sendEvmCall(network, accountRow, from, token, 0n, data)
  const receipt = await waitForEvmReceipt(network, txid, 60_000)
  const status = asString(asRecord(receipt)?.status)
  if (status && status !== '0x1' && status !== '1') throw invalidArg('代币授权失败，请重试')
  return txid
}

async function sendEvmSwap(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  transaction: Record<string, unknown> | null,
): Promise<string> {
  if (!transaction) throw invalidArg('报价缺少待签名交易')
  const to = asString(transaction.to)
  const data = asString(transaction.data)
  if (!to || !data) throw invalidArg('报价交易缺少 to / data')
  const value = parseWei(transaction.value)
  const hex = (data.startsWith('0x') ? data : `0x${data}`) as Hex
  return sendEvmCall(network, accountRow, from, to, value, hex, parseOptionalGas(transaction.gas))
}

async function sendEvmCall(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  to: string,
  value: bigint,
  data: Hex,
  gasOverride?: bigint,
): Promise<string> {
  const [nonce, fees] = await Promise.all([getEvmNonce(network, from), quoteEvmFees(network)])
  const gasLimit =
    gasOverride ??
    (await estimateEvmGas({
      network,
      from,
      to,
      value,
      data,
    }))
  const signed = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
    signAndSerializeEvmTx({
      privateKey,
      chainId: Number(normalizeChainId(network.chainId)),
      nonce,
      to,
      value,
      data,
      gasLimit,
      fee: fees.medium,
    }),
  )
  return broadcastEvmTx(network, signed.hex)
}

function parseOptionalGas(value: unknown): bigint | undefined {
  if (value == null || value === '') return undefined
  try {
    const gas = parseWei(value)
    return gas > 0n ? (gas * 120n) / 100n : undefined
  } catch {
    return undefined
  }
}

async function approveTron(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  token: string,
  spender: string,
  amount: bigint,
): Promise<string> {
  const unsigned = await createTronContractTx({
    from,
    contract: token,
    selector: 'approve(address,uint256)',
    parameter: encodeTrc20TransferParameter(spender, amount),
    feeLimitSun: 40_000_000n,
    networkScope: network.networkScope,
  })
  const signed = withAccountPrivateKey(accountRow, (privateKey) => signTronTx(unsigned, privateKey))
  const txid = await broadcastTronTx(signed, network.networkScope)
  await waitForTronTx(txid, network)
  return txid
}

async function sendTronSwap(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  transaction: Record<string, unknown> | null,
): Promise<string> {
  if (!transaction) throw invalidArg('报价缺少波场待签名交易')
  const raw = asRecord(transaction.raw) ?? transaction
  const txID = asString(raw.txID ?? raw.txid)
  if (!txID) throw invalidArg('波场兑换交易缺少 txID')
  const unsigned = { ...raw, txID } as TronUnsignedTx
  const signed = withAccountPrivateKey(accountRow, (privateKey) => signTronTx(unsigned, privateKey))
  return broadcastTronTx(signed, network.networkScope)
}

async function waitForTronTx(txid: string, network: NetworkRecord, timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await fetchTronTxInfo(txid, network.networkScope)
    const record = asRecord(info)
    if (record && (record.id || record.blockNumber || record.receipt)) return
    await sleep(2_000)
  }
}
