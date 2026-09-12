/**
 * 跨链桥：询价、必要时授权 / 租能量，本机签源链交易后上报 hash。
 */
import { encodeFunctionData, erc20Abi, type Hex } from 'viem'
import type {
  AccountRecord,
  BridgeHistoryItem,
  BridgeQuote,
  BridgeQuoteInput,
  BridgeStatus,
  BridgeSubmitInput,
  BridgeSubmitResult,
  NetworkRecord,
  TokenRecord,
  TronEnergyFeeMode,
} from '@shared/types'
import { getBaseUrl } from '../backend/config'
import { asRecord, asString } from '../backend/list'
import {
  broadcastBitcoinTx,
  buildAndSignBitcoinTx,
  fetchFeeRates,
  signBitcoinPsbt,
} from '../chain/bitcoin'
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
  getTronEnergyFeeSun,
  signTronTx,
  type TronUnsignedTx,
} from '../chain/tron'
import { getAccountRow } from '../db/repos/accountRepo'
import { getNetwork, getToken } from '../db/repos/catalogRepo'
import { isBitcoinAddress } from '../derive/bitcoin'
import { isEvmAddress, toChecksumAddress } from '../derive/evm'
import { isTronAddress } from '../derive/tron'
import { ENERGY_CATALOG_HINT, burnSunForEnergy, compareEnergyFees, rentQuantity, sunToTrx } from '../energy/codec'
import { estimateEnergyOrder } from '../energy/api'
import { loadEnergyResources, rentEnergyAndWait } from '../energy/service'
import { invalidArg, notFound } from '../ipc/registry'
import { normalizeChainId } from '../rpc/endpoints'
import { explorerUrlForNetwork, persistBroadcastedTx } from '../txLab/service'
import { formatMinor, parseDecimalToMinor } from '../util/amount'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import { fetchBridgeOrderStatus, fetchBridgePrice, fetchBridgeQuote, listBridgeOrders, submitBridgeHash } from './api'
import {
  BRIDGE_FALLBACK_ENERGY,
  DEFAULT_SLIPPAGE_BPS,
  bridgeChainIdOf,
  bridgeFamilyOf,
  involvesBtc,
  originHashForBackend,
  parseQuoteIndex,
  parseSlippageBps,
  parseSortQuotesBy,
  parseWei,
  tokenAddressForBridge,
  type BridgeFamily,
} from './codec'

function requireCatalogUrl(): void {
  if (!getBaseUrl()) throw invalidArg(`请先在设置里填写目录站地址，跨链桥使用 ${ENERGY_CATALOG_HINT}`)
}

function requireNetwork(id: string): NetworkRecord {
  const network = getNetwork(id)
  if (!network) throw notFound('网络不存在，请先同步目录')
  return network
}

function requireBridgeChain(network: NetworkRecord): { chainId: number; family: BridgeFamily } {
  const chainId = bridgeChainIdOf(network)
  if (chainId == null) {
    throw invalidArg('跨链仅支持 Bitcoin 主网、Ethereum / BSC / Arbitrum 和波场主网')
  }
  return { chainId, family: bridgeFamilyOf(chainId) }
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

function assertDestAddress(chainId: number, address: string): string {
  const raw = address.trim()
  const family = bridgeFamilyOf(chainId)
  if (family === 'evm') {
    if (!isEvmAddress(raw)) throw invalidArg('目标地址必须是有效的 EVM 地址')
    return toChecksumAddress(raw)
  }
  if (family === 'utxo') {
    if (!isBitcoinAddress(raw, 'mainnet')) throw invalidArg('目标地址必须是比特币主网地址')
    return raw
  }
  if (!isTronAddress(raw)) throw invalidArg('目标地址必须是有效的波场地址')
  return raw
}

function resolveDestAddress(input: BridgeQuoteInput, destNetwork: NetworkRecord, destChainId: number): string {
  const pasted = input.destAddress?.trim()
  if (pasted) return assertDestAddress(destChainId, pasted)
  if (input.destAccountId) {
    const dest = getAccount(input.destAccountId)
    if (dest.walletType !== destNetwork.walletType) throw invalidArg('收款账户与目标网络不匹配')
    return assertDestAddress(destChainId, dest.address)
  }
  throw invalidArg('请选择目标链收款账户或填写收款地址')
}

function buildPriceQuery(input: {
  originChainId: number
  destChainId: number
  originAddress: string
  destAddress: string
  sellAddress: string
  buyAddress: string
  sellAmountMinor: string
  slippageBps: number
  sortQuotesBy: 'price' | 'speed'
  quoteIndex?: number
}): Record<string, string | number> {
  const query: Record<string, string | number> = {
    originChainId: input.originChainId,
    destinationChainId: input.destChainId,
    sellToken: input.sellAddress,
    buyToken: input.buyAddress,
    sellAmount: input.sellAmountMinor,
    originAddress: input.originAddress,
    destinationAddress: input.destAddress,
    slippageBps: input.slippageBps,
    sortQuotesBy: input.sortQuotesBy,
    maxNumQuotes: 3,
  }
  if (input.quoteIndex != null) query.quoteIndex = input.quoteIndex
  return query
}

async function resolveContext(input: BridgeQuoteInput) {
  requireCatalogUrl()
  const originNetwork = requireNetwork(input.originNetworkPk)
  const destNetwork = requireNetwork(input.destNetworkPk)
  const origin = requireBridgeChain(originNetwork)
  const dest = requireBridgeChain(destNetwork)
  if (origin.chainId === dest.chainId) throw invalidArg('源链和目标链不能相同，同网络请用兑换')
  const account = getAccount(input.originAccountId)
  if (account.walletType !== originNetwork.walletType) throw invalidArg('付款账户与源链网络不匹配')
  const sellToken = requireTokenRow(input.sellTokenPk)
  const buyToken = requireTokenRow(input.buyTokenPk)
  if (sellToken.networkPk !== originNetwork.id) throw invalidArg('卖出代币必须属于源链网络')
  if (buyToken.networkPk !== destNetwork.id) throw invalidArg('买入代币必须属于目标链网络')
  if (origin.family === 'utxo' && sellToken.isToken) throw invalidArg('比特币跨链一期只支持原生 BTC')
  if (dest.family === 'utxo' && buyToken.isToken) throw invalidArg('比特币跨链一期只支持原生 BTC')
  const sellAddress = tokenAddressForBridge({
    chainId: origin.chainId,
    isToken: sellToken.isToken,
    contractAddress: sellToken.contractAddress,
  })
  const buyAddress = tokenAddressForBridge({
    chainId: dest.chainId,
    isToken: buyToken.isToken,
    contractAddress: buyToken.contractAddress,
  })
  const sellAmountMinor = parseDecimalToMinor(input.sellAmount, sellToken.decimals)
  if (sellAmountMinor <= 0n) throw invalidArg('卖出数量必须大于 0')
  const destAddress = resolveDestAddress(input, destNetwork, dest.chainId)
  return {
    originNetwork,
    destNetwork,
    origin,
    dest,
    account,
    sellToken,
    buyToken,
    sellAddress,
    buyAddress,
    sellAmountMinor,
    destAddress,
    slippageBps: parseSlippageBps(input.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    sortQuotesBy: parseSortQuotesBy(input.sortQuotesBy),
  }
}

async function resolveBridgeEnergy(
  accountId: string,
  network: NetworkRecord,
  sellIsToken: boolean,
  destChainId: number,
): Promise<BridgeQuote['energy']> {
  const mayNeedEnergy = sellIsToken || destChainId !== 0
  if (!mayNeedEnergy) return null
  const [resources, energyFeeSun] = await Promise.all([
    loadEnergyResources(accountId, network.id).catch(() => null),
    getTronEnergyFeeSun(network.networkScope).catch(() => 210n),
  ])
  const left = resources?.energyLeft ?? 0
  const required = BRIDGE_FALLBACK_ENERGY
  if (left >= required) return null
  const quantity = rentQuantity(required, left)
  const burnSun = burnSunForEnergy(required, left, energyFeeSun)
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

export async function quoteBridge(input: BridgeQuoteInput): Promise<BridgeQuote> {
  const ctx = await resolveContext(input)
  const priced = await fetchBridgePrice(
    buildPriceQuery({
      originChainId: ctx.origin.chainId,
      destChainId: ctx.dest.chainId,
      originAddress: ctx.account.address,
      destAddress: ctx.destAddress,
      sellAddress: ctx.sellAddress,
      buyAddress: ctx.buyAddress,
      sellAmountMinor: ctx.sellAmountMinor.toString(),
      slippageBps: ctx.slippageBps,
      sortQuotesBy: ctx.sortQuotesBy,
    }),
  )
  const warnings = [...priced.warnings]
  let energy: BridgeQuote['energy'] = null
  if (ctx.origin.family === 'tvm') {
    energy = await resolveBridgeEnergy(ctx.account.id, ctx.originNetwork, ctx.sellToken.isToken, ctx.dest.chainId)
    if (energy?.needed && !energy.rentTrx) warnings.push('暂时无法租赁能量，将只能燃烧 TRX')
  }
  return {
    originChainId: ctx.origin.chainId,
    destinationChainId: ctx.dest.chainId,
    originAddress: ctx.account.address,
    destinationAddress: ctx.destAddress,
    sellSymbol: ctx.sellToken.symbol,
    buySymbol: ctx.buyToken.symbol,
    sellAmount: formatMinor(ctx.sellAmountMinor, ctx.sellToken.decimals),
    options: priced.options.map((item) => ({
      index: item.index,
      sellAmount: formatMinor(BigInt(item.sellAmount || ctx.sellAmountMinor.toString()), ctx.sellToken.decimals),
      buyAmount: item.buyAmount ? formatMinor(BigInt(item.buyAmount), ctx.buyToken.decimals) : '0',
      minBuyAmount: formatMinor(BigInt(item.minBuyAmount || item.buyAmount || '0'), ctx.buyToken.decimals),
      estimatedTimeSeconds: item.estimatedTimeSeconds,
      feeText: item.feeText,
      allowanceNeeded: item.allowanceNeeded,
      allowanceTarget: item.allowanceTarget,
    })),
    energy,
    warnings,
    provider: priced.provider || (involvesBtc(ctx.origin.chainId, ctx.dest.chainId) ? 'swapkit' : null),
    liquidityAvailable: priced.liquidityAvailable,
  }
}

export async function submitBridge(input: BridgeSubmitInput): Promise<BridgeSubmitResult> {
  const ctx = await resolveContext(input)
  const accountRow = requireAccountRow(input.originAccountId)
  const quoteIndex = parseQuoteIndex(input.quoteIndex)
  const query = buildPriceQuery({
    originChainId: ctx.origin.chainId,
    destChainId: ctx.dest.chainId,
    originAddress: ctx.account.address,
    destAddress: ctx.destAddress,
    sellAddress: ctx.sellAddress,
    buyAddress: ctx.buyAddress,
    sellAmountMinor: ctx.sellAmountMinor.toString(),
    slippageBps: ctx.slippageBps,
    sortQuotesBy: ctx.sortQuotesBy,
    quoteIndex,
  })

  if (ctx.origin.family === 'tvm' && input.energyFeeMode === 'rent') {
    const energy = await resolveBridgeEnergy(ctx.account.id, ctx.originNetwork, ctx.sellToken.isToken, ctx.dest.chainId)
    if (energy?.needed && energy.quantity > 0) {
      await rentEnergyAndWait({
        accountId: ctx.account.id,
        networkPk: ctx.originNetwork.id,
        quantity: energy.quantity,
        duration: '1h',
      })
    }
  }

  const quote = await fetchBridgeQuote(query)
  const needApprove =
    Boolean(quote.allowanceTarget) &&
    ctx.sellToken.isToken &&
    Boolean(ctx.sellToken.contractAddress) &&
    (quote.allowanceNeeded || Boolean(quote.allowanceTarget))

  let approveTxid: string | null = null
  if (needApprove && quote.allowanceTarget && ctx.sellToken.contractAddress) {
    if (ctx.origin.family === 'evm') {
      approveTxid = await approveEvm(
        ctx.originNetwork,
        accountRow,
        ctx.account.address,
        ctx.sellToken.contractAddress,
        quote.allowanceTarget,
        ctx.sellAmountMinor,
      )
    } else if (ctx.origin.family === 'tvm') {
      approveTxid = await approveTron(
        ctx.originNetwork,
        accountRow,
        ctx.account.address,
        ctx.sellToken.contractAddress,
        quote.allowanceTarget,
        ctx.sellAmountMinor,
      )
    }
  }

  const txid =
    ctx.origin.family === 'evm'
      ? await sendEvmBridge(ctx.originNetwork, accountRow, ctx.account.address, quote.transaction)
      : ctx.origin.family === 'tvm'
        ? await sendTronBridge(ctx.originNetwork, accountRow, quote.transaction)
        : await sendBtcBridge(ctx.account, accountRow, quote.transaction, ctx.sellAmountMinor)

  const submitted = await submitBridgeHash({
    quoteId: quote.quoteId,
    txHash: originHashForBackend(ctx.origin.family, txid),
    originAddress: ctx.account.address,
  })

  persistBroadcastedTx({
    network: ctx.originNetwork,
    accountId: ctx.account.id,
    from: ctx.account.address,
    to: ctx.destAddress,
    tokenPk: ctx.sellToken.id,
    symbol: ctx.sellToken.symbol,
    amount: formatMinor(ctx.sellAmountMinor, ctx.sellToken.decimals),
    fee: null,
    txid,
    raw: '',
  })

  return {
    quoteId: quote.quoteId,
    txid,
    approveTxid,
    explorerUrl: explorerUrlForNetwork(ctx.originNetwork, txid),
    destTxHash: submitted.destTxHash,
    status: submitted.status || 'SUBMITTED',
  }
}

export async function getBridgeStatus(quoteId: string): Promise<BridgeStatus> {
  requireCatalogUrl()
  if (!quoteId.trim()) throw invalidArg('缺少 quoteId')
  return fetchBridgeOrderStatus(quoteId.trim())
}

export async function listAccountBridges(accountId: string, networkPk: string): Promise<BridgeHistoryItem[]> {
  requireCatalogUrl()
  const network = requireNetwork(networkPk)
  const { chainId } = requireBridgeChain(network)
  const account = getAccount(accountId)
  return listBridgeOrders(account.address, chainId)
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

async function sendEvmBridge(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  transaction: Record<string, unknown> | null,
): Promise<string> {
  if (!transaction) throw invalidArg('报价缺少待签名交易')
  const to = asString(transaction.to)
  const data = asString(transaction.data)
  if (!to) throw invalidArg('报价交易缺少 to')
  const value = parseWei(transaction.value)
  const hex = ((data || '0x').startsWith('0x') ? data || '0x' : `0x${data}`) as Hex
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

function unwrapTvmUnsigned(transaction: Record<string, unknown>): TronUnsignedTx {
  const nested =
    asRecord(transaction.rawTransaction) ?? asRecord(transaction.transaction) ?? asRecord(transaction.raw)
  const candidate = nested && (asString(nested.txID) || asString(nested.txid)) ? nested : transaction
  const inner = asRecord(candidate.transaction)
  const raw = inner && (asString(inner.txID) || asString(inner.txid)) ? inner : candidate
  const txID = asString(raw.txID ?? raw.txid)
  if (!txID) throw invalidArg('波场跨链交易缺少 txID，无法签名')
  return { ...raw, txID } as TronUnsignedTx
}

async function sendTronBridge(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  transaction: Record<string, unknown> | null,
): Promise<string> {
  if (!transaction) throw invalidArg('报价缺少波场待签名交易')
  const unsigned = unwrapTvmUnsigned(transaction)
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

async function sendBtcBridge(
  account: AccountRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  transaction: Record<string, unknown> | null,
  sellAmountSats: bigint,
): Promise<string> {
  if (!transaction) throw invalidArg('报价缺少比特币待签名交易')
  const inbound = asString(transaction.to || transaction.inboundAddress)
  const psbt = asString(transaction.psbt)
  const memo = asString(transaction.memo)
  const valueSats = (() => {
    try {
      const parsed = parseWei(transaction.value)
      return parsed > 0n ? parsed : sellAmountSats
    } catch {
      return sellAmountSats
    }
  })()
  return withAccountPrivateKeyAsync(accountRow, async (privateKey) => {
    if (psbt) {
      const hex = signBitcoinPsbt(psbt, privateKey)
      return broadcastBitcoinTx(hex, 'mainnet')
    }
    if (!inbound) throw invalidArg('比特币跨链缺少 inbound 地址或 PSBT')
    if (!account.addressType) throw invalidArg('比特币账户缺少地址类型')
    const fees = await fetchFeeRates('mainnet')
    const built = await buildAndSignBitcoinTx({
      networkScope: 'mainnet',
      addressType: account.addressType,
      fromAddress: account.address,
      toAddress: inbound,
      publicKeyHex: account.publicKey,
      privateKey,
      amountSats: valueSats,
      feeRate: fees.medium,
      memo: memo || undefined,
    })
    return broadcastBitcoinTx(built.hex, 'mainnet')
  })
}
