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
import { asNumber, asRecord, asString } from '../backend/list'
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
  fetchTronAccountInternal,
  fetchTronAccountTrc20,
  fetchTronTxInfo,
  getTronEnergyFeeSun,
  signTronTx,
  type TronUnsignedTx,
} from '../chain/tron'
import { getAccountRow } from '../db/repos/accountRepo'
import { getNetwork, getToken, listNetworks } from '../db/repos/catalogRepo'
import { parseTronGridInternal, parseTronGridTrc20 } from '../history/parse'
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
  formatGasLimitFee,
  involvesBtc,
  isBridgeStatusTerminal,
  originHashForBackend,
  parseQuoteIndex,
  resolveBridgeHistoryStatus,
  parseSlippageBps,
  parseSortQuotesBy,
  parseWei,
  tokenAddressForBridge,
  type BridgeFamily,
} from './codec'

function requireCatalogUrl(): void {
  if (!getBaseUrl()) throw invalidArg(`请先在设置里填写目录站地址，跨链桥使用 ${ENERGY_CATALOG_HINT}`)
}

function nativeMeta(network: NetworkRecord, family: BridgeFamily): { symbol: string; decimals: number } {
  if (family === 'utxo') return { symbol: network.coinEasy || 'BTC', decimals: 8 }
  if (family === 'tvm') return { symbol: network.coinEasy || 'TRX', decimals: 6 }
  return { symbol: network.coinEasy || 'ETH', decimals: 18 }
}

function evmFeeFromReceipt(receipt: unknown, symbol: string): string | null {
  const record = asRecord(receipt)
  if (!record) return null
  try {
    const gasUsed = parseWei(record.gasUsed)
    const gasPrice = parseWei(record.effectiveGasPrice ?? record.gasPrice)
    if (gasUsed <= 0n || gasPrice <= 0n) return null
    return `${formatMinor(gasUsed * gasPrice, 18)} ${symbol}`
  } catch {
    return null
  }
}

function tronFeeFromInfo(info: unknown): string | null {
  const record = asRecord(info)
  if (!record) return null
  const receipt = asRecord(record.receipt)
  const fee = BigInt(Math.max(0, asNumber(record.fee, 0)))
  const energyFee = BigInt(Math.max(0, asNumber(receipt?.energy_fee, 0)))
  const netFee = BigInt(Math.max(0, asNumber(receipt?.net_fee, 0)))
  const total = fee > 0n ? fee : energyFee + netFee
  if (total <= 0n) return null
  return `${formatMinor(total, 6)} TRX`
}

async function estimateOriginNetworkFee(input: {
  family: BridgeFamily
  network: NetworkRecord
  from: string
  transaction: Record<string, unknown> | null
  energy: BridgeQuote['energy']
}): Promise<string | null> {
  const native = nativeMeta(input.network, input.family)
  if (input.family === 'tvm') {
    if (input.energy?.needed) {
      return input.energy.rentTrx
        ? `${input.energy.rentTrx} TRX`
        : input.energy.burnTrx
          ? `${input.energy.burnTrx} TRX`
          : null
    }
    return null
  }
  if (input.family === 'utxo') {
    try {
      const rates = await fetchFeeRates('mainnet')
      const feeSats = BigInt(Math.ceil(141 * rates.medium * 1.2))
      return `${formatMinor(feeSats, 8)} ${native.symbol}`
    } catch {
      return null
    }
  }
  const fromQuote = formatGasLimitFee(
    input.transaction?.gas,
    input.transaction?.gasPrice ?? input.transaction?.maxFeePerGas,
    native.symbol,
    native.decimals,
  )
  if (fromQuote) return fromQuote
  try {
    const fees = await quoteEvmFees(input.network)
    const price = fees.medium.maxFeePerGas || fees.medium.gasPrice || 0n
    let gas = 180_000n
    const quotedGas = (() => {
      try {
        const value = parseWei(input.transaction?.gas)
        return value > 0n ? value : 0n
      } catch {
        return 0n
      }
    })()
    if (quotedGas > 0n) gas = quotedGas
    const to = asString(input.transaction?.to)
    const data = asString(input.transaction?.data)
    if (to && quotedGas <= 0n) {
      try {
        const hex = ((data || '0x').startsWith('0x') ? data || '0x' : `0x${data}`) as Hex
        gas = await estimateEvmGas({
          network: input.network,
          from: input.from,
          to,
          value: parseWei(input.transaction?.value),
          data: hex,
        })
      } catch {
        /* 用 AllowanceHolder 常见消耗兜底 */
      }
    }
    if (price <= 0n) return `${gas.toString()} gas`
    return `${formatMinor(gas * price, 18)} ${native.symbol}`
  } catch {
    return '180000 gas'
  }
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
  const native = nativeMeta(ctx.originNetwork, ctx.origin.family)
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
    native,
  )
  const warnings = [...priced.warnings]
  let energy: BridgeQuote['energy'] = null
  if (ctx.origin.family === 'tvm') {
    energy = await resolveBridgeEnergy(ctx.account.id, ctx.originNetwork, ctx.sellToken.isToken, ctx.dest.chainId)
    if (energy?.needed && !energy.rentTrx) warnings.push('暂时无法租赁能量，将只能燃烧 TRX')
  }
  const estimated = await estimateOriginNetworkFee({
    family: ctx.origin.family,
    network: ctx.originNetwork,
    from: ctx.account.address,
    transaction: priced.options[0]?.transaction ?? null,
    energy,
  })
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
      networkFeeText: item.networkFeeText || estimated,
      allowanceNeeded: item.allowanceNeeded,
      allowanceTarget: item.allowanceTarget,
    })),
    energy,
    networkFeeText: priced.options[0]?.networkFeeText || estimated,
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

  const quote = await fetchBridgeQuote(query, nativeMeta(ctx.originNetwork, ctx.origin.family))
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

  const sent =
    ctx.origin.family === 'evm'
      ? await sendEvmBridge(ctx.originNetwork, accountRow, ctx.account.address, quote.transaction)
      : ctx.origin.family === 'tvm'
        ? await sendTronBridge(ctx.originNetwork, accountRow, quote.transaction)
        : await sendBtcBridge(ctx.account, accountRow, quote.transaction, ctx.sellAmountMinor)

  const submitted = await submitBridgeHash({
    quoteId: quote.quoteId,
    txHash: originHashForBackend(ctx.origin.family, sent.txid),
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
    fee: sent.feeText,
    txid: sent.txid,
    raw: '',
  })

  return {
    quoteId: quote.quoteId,
    txid: sent.txid,
    approveTxid,
    explorerUrl: explorerUrlForNetwork(ctx.originNetwork, sent.txid),
    destTxHash: submitted.destTxHash,
    status: submitted.status || 'SUBMITTED',
    feeText: sent.feeText,
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
  const rows = await listBridgeOrders(account.address, chainId)
  let refreshing = 0
  return Promise.all(
    rows.map((row) => {
      const status = row.status.trim().toUpperCase()
      if (status === 'QUOTE' || isBridgeStatusTerminal(status)) return row
      refreshing += 1
      if (refreshing > 5) return confirmDestFilled(row)
      return refreshBridgeHistoryRow(row)
    }),
  )
}

function networkByBridgeChain(chainId: number): NetworkRecord | null {
  return listNetworks().find((item) => bridgeChainIdOf(item) === chainId) ?? null
}

function amountsClose(actual: bigint, expected: string): boolean {
  if (!expected) return actual > 0n
  try {
    const want = BigInt(expected)
    if (want <= 0n) return actual > 0n
    const delta = actual > want ? actual - want : want - actual
    return delta * 100n <= want * 2n
  } catch {
    return false
  }
}

function sameTokenAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

async function confirmDestFilled(row: BridgeHistoryItem): Promise<BridgeHistoryItem> {
  if (!row.destinationAddress || row.destinationChainId !== 195) return row
  const dest = networkByBridgeChain(195)
  if (!dest) return row
  const created = Date.parse(row.created) || 0
  const native = !row.buyToken || row.buyToken === 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
  try {
    const drafts = native
      ? parseTronGridInternal(await fetchTronAccountInternal(row.destinationAddress, dest.networkScope), row.destinationAddress)
      : parseTronGridTrc20(await fetchTronAccountTrc20(row.destinationAddress, dest.networkScope), row.destinationAddress)
    const hit = drafts.find((item) => {
      if (item.direction !== 'receive' || !item.txid) return false
      if (created && item.timestampMs + 60_000 < created) return false
      if (!native && item.contractAddress && row.buyToken && !sameTokenAddress(item.contractAddress, row.buyToken)) {
        return false
      }
      return amountsClose(item.amountMinor, row.buyAmount)
    })
    if (hit) return { ...row, status: 'FILLED', destTxHash: hit.txid }
  } catch {
    /* 目标链核对失败时保持目录状态 */
  }
  return row
}

async function refreshBridgeHistoryRow(row: BridgeHistoryItem): Promise<BridgeHistoryItem> {
  const status = row.status.trim().toUpperCase()
  if (status === 'QUOTE' || isBridgeStatusTerminal(status)) {
    return { ...row, status: resolveBridgeHistoryStatus(row.status, row.destTxHash) }
  }
  let next = row
  if (row.id) {
    try {
      const live = await fetchBridgeOrderStatus(row.id)
      next = {
        ...row,
        status: live.status || row.status,
        destTxHash: live.destTxHash || row.destTxHash,
        txHash: live.txHash || row.txHash,
      }
    } catch {
      /* 目录状态接口失败时再核对目标链 */
    }
  }
  next = { ...next, status: resolveBridgeHistoryStatus(next.status, next.destTxHash) }
  if (isBridgeStatusTerminal(next.status)) return next
  return confirmDestFilled(next)
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
  const sent = await sendEvmCall(network, accountRow, from, token, 0n, data)
  const receipt = await waitForEvmReceipt(network, sent.txid, 60_000)
  const status = asString(asRecord(receipt)?.status)
  if (status && status !== '0x1' && status !== '1') throw invalidArg('代币授权失败，请重试')
  return sent.txid
}

async function sendEvmBridge(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  transaction: Record<string, unknown> | null,
): Promise<{ txid: string; feeText: string | null }> {
  if (!transaction) throw invalidArg('报价缺少待签名交易')
  const to = asString(transaction.to)
  const data = asString(transaction.data)
  if (!to) throw invalidArg('报价交易缺少 to')
  const value = parseWei(transaction.value)
  const hex = ((data || '0x').startsWith('0x') ? data || '0x' : `0x${data}`) as Hex
  const sent = await sendEvmCall(network, accountRow, from, to, value, hex, parseOptionalGas(transaction.gas))
  const receipt = await waitForEvmReceipt(network, sent.txid, 60_000)
  const symbol = nativeMeta(network, 'evm').symbol
  return {
    txid: sent.txid,
    feeText: evmFeeFromReceipt(receipt, symbol) || sent.feeText,
  }
}

async function sendEvmCall(
  network: NetworkRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  from: string,
  to: string,
  value: bigint,
  data: Hex,
  gasOverride?: bigint,
): Promise<{ txid: string; feeText: string | null }> {
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
  const symbol = nativeMeta(network, 'evm').symbol
  const feeMinor = (fees.medium.maxFeePerGas || fees.medium.gasPrice || 0n) * gasLimit
  return {
    txid: await broadcastEvmTx(network, signed.hex),
    feeText: feeMinor > 0n ? `${formatMinor(feeMinor, 18)} ${symbol}` : null,
  }
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
): Promise<{ txid: string; feeText: string | null }> {
  if (!transaction) throw invalidArg('报价缺少波场待签名交易')
  const unsigned = unwrapTvmUnsigned(transaction)
  const signed = withAccountPrivateKey(accountRow, (privateKey) => signTronTx(unsigned, privateKey))
  const txid = await broadcastTronTx(signed, network.networkScope)
  const info = await waitForTronTx(txid, network)
  return { txid, feeText: tronFeeFromInfo(info) }
}

async function waitForTronTx(txid: string, network: NetworkRecord, timeoutMs = 45_000): Promise<unknown | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const info = await fetchTronTxInfo(txid, network.networkScope)
    const record = asRecord(info)
    if (record && (record.id || record.blockNumber || record.receipt)) return info
    await sleep(2_000)
  }
  return null
}

async function sendBtcBridge(
  account: AccountRecord,
  accountRow: ReturnType<typeof requireAccountRow>,
  transaction: Record<string, unknown> | null,
  sellAmountSats: bigint,
): Promise<{ txid: string; feeText: string | null }> {
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
      return { txid: await broadcastBitcoinTx(hex, 'mainnet'), feeText: null }
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
    return {
      txid: await broadcastBitcoinTx(built.hex, 'mainnet'),
      feeText: `${formatMinor(built.feeSats, 8)} BTC`,
    }
  })
}
