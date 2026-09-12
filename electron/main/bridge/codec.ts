/**
 * 跨链桥：链映射、代币占位、询价 / 状态解包。不发网络请求。
 */
import { asNumber, asRecord, asString } from '../backend/list'
import {
  DEFAULT_SLIPPAGE_BPS,
  EVM_NATIVE_PLACEHOLDER,
  TRON_NATIVE_PLACEHOLDER,
  parseMinorAmount,
  parseSlippageBps,
  parseWei,
} from '../swap/codec'

export const BRIDGE_API_PREFIX = '/api/swapCross'
export const BRIDGE_CHAIN_IDS = [0, 1, 56, 42161, 195] as const
export const BTC_BRIDGE_CHAIN_ID = 0
export const BTC_NATIVE_PLACEHOLDER = 'BTC'
export const DEFAULT_MAX_QUOTES = 3
export const BRIDGE_FALLBACK_ENERGY = 150_000

export type BridgeFamily = 'utxo' | 'evm' | 'tvm'
export type BridgeSortBy = 'price' | 'speed'

export function bridgeChainIdOf(input: {
  walletType: string
  networkScope: string
  chainId: string
}): number | null {
  if (input.walletType === 'bitcoin' && input.networkScope === 'mainnet') return BTC_BRIDGE_CHAIN_ID
  if (input.walletType === 'tron' && input.networkScope === 'mainnet') return 195
  if (input.walletType !== 'web3') return null
  const raw = input.chainId.trim()
  const id = /^0x/i.test(raw) ? Number.parseInt(raw, 16) : Number(raw)
  return id === 1 || id === 56 || id === 42161 ? id : null
}

export function bridgeFamilyOf(chainId: number): BridgeFamily {
  if (chainId === BTC_BRIDGE_CHAIN_ID) return 'utxo'
  if (chainId === 195) return 'tvm'
  return 'evm'
}

export function involvesBtc(originChainId: number, destinationChainId: number): boolean {
  return originChainId === BTC_BRIDGE_CHAIN_ID || destinationChainId === BTC_BRIDGE_CHAIN_ID
}

export function tokenAddressForBridge(input: {
  chainId: number
  isToken: boolean
  contractAddress: string | null
}): string {
  const family = bridgeFamilyOf(input.chainId)
  const contract = (input.contractAddress ?? '').trim()
  if (!input.isToken || !contract || contract === '0' || /^0x0+$/i.test(contract)) {
    if (family === 'utxo') return BTC_NATIVE_PLACEHOLDER
    return family === 'tvm' ? TRON_NATIVE_PLACEHOLDER : EVM_NATIVE_PLACEHOLDER
  }
  if (family === 'utxo') throw new Error('比特币跨链一期只支持原生 BTC')
  return contract
}

export function parseSortQuotesBy(value: unknown): BridgeSortBy {
  if (value === undefined || value === null || value === '') return 'price'
  const text = String(value).trim()
  if (text === 'price' || text === 'speed') return text
  throw new Error('排序仅支持 price 或 speed')
}

export function parseQuoteIndex(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < 0) throw new Error('quoteIndex 必须是非负整数')
  return n
}

export function parseEstimatedSeconds(value: unknown): number | null {
  const n = asNumber(value, Number.NaN)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.ceil(n)
}

export function originHashForBackend(family: BridgeFamily, txid: string): string {
  const raw = txid.trim()
  if (family === 'evm') return raw.startsWith('0x') ? raw : `0x${raw}`
  return raw.replace(/^0x/i, '').toLowerCase()
}

export function parseBridgeFeeText(fees: unknown): string {
  if (Array.isArray(fees) && fees.length) {
    const first = asRecord(fees[0])
    const amount = asString(first?.amount ?? first?.total ?? first?.fee)
    const asset = asString(first?.asset ?? first?.symbol ?? first?.type)
    if (amount && asset) return `${amount} ${asset}`
    if (amount) return amount
  }
  const record = asRecord(fees)
  if (!record) return '桥费见报价'
  const amount = asString(record.total ?? record.amount ?? record.fee)
  const asset = asString(record.asset ?? record.symbol)
  if (amount && asset) return `${amount} ${asset}`
  if (amount) return amount
  return '桥费见报价'
}

export function parseQuoteOption(row: unknown, index: number) {
  const record = asRecord(row)
  if (!record) throw new Error('跨链报价条目无效')
  const issues = asRecord(record.issues)
  const allowance = asRecord(issues?.allowance)
  const allowanceTarget = asString(
    record.allowanceTarget || allowance?.spender || issues?.spender,
  )
  const buyAmount = asString(record.buyAmount)
  if (buyAmount) parseMinorAmount(buyAmount)
  return {
    index,
    sellAmount: asString(record.sellAmount),
    buyAmount,
    minBuyAmount: asString(record.minBuyAmount || record.buyAmount),
    estimatedTimeSeconds: parseEstimatedSeconds(record.estimatedTimeSeconds),
    feeText: parseBridgeFeeText(record.fees),
    allowanceNeeded: Boolean(allowanceTarget) && Boolean(issues?.allowance || allowance?.spender),
    allowanceTarget: allowanceTarget || null,
    transaction: asRecord(record.transaction),
    providers: asString(record.providers ?? record.bridge) || null,
  }
}

export function parsePriceResponse(data: unknown) {
  const record = asRecord(data)
  if (!record) throw new Error('跨链询价响应无效')
  const quotes = Array.isArray(record.quotes) ? record.quotes : []
  const warnings: string[] = []
  if (record.liquidityAvailable === false || quotes.length === 0) {
    warnings.push('当前跨链交易对暂无可用流动性')
  }
  return {
    originChainId: asNumber(record.originChainId, 0),
    destinationChainId: asNumber(record.destinationChainId, 0),
    originAddress: asString(record.originAddress),
    destinationAddress: asString(record.destinationAddress),
    sellToken: asString(record.sellToken),
    buyToken: asString(record.buyToken),
    liquidityAvailable: record.liquidityAvailable !== false && quotes.length > 0,
    provider: asString(record.provider) || null,
    options: quotes.map((item, index) => parseQuoteOption(item, index)),
    warnings,
  }
}

export function parseExecutableQuote(data: unknown) {
  const record = asRecord(data)
  if (!record) throw new Error('跨链可执行报价无效')
  const quoteId = asString(record.quoteId ?? record.id)
  if (!quoteId) throw new Error('报价未返回 quoteId')
  const option = parseQuoteOption(record, 0)
  if (!option.transaction) throw new Error('报价未返回待签名交易')
  return {
    quoteId,
    sellAmount: option.sellAmount,
    buyAmount: option.buyAmount,
    minBuyAmount: option.minBuyAmount,
    allowanceNeeded: option.allowanceNeeded,
    allowanceTarget: option.allowanceTarget || asString(record.allowanceTarget) || null,
    transaction: option.transaction,
    estimatedTimeSeconds: option.estimatedTimeSeconds,
    expiresAt: asString(record.expiresAt) || null,
    provider: asString(record.provider) || null,
    status: asString(record.status, 'QUOTE'),
  }
}

export function parseBridgeStatus(data: unknown) {
  const record = asRecord(data)
  if (!record) throw new Error('跨链状态响应无效')
  const txHash = asString(record.txHash ?? record.tx_hash)
  const destTxHash = asString(record.destTxHash ?? record.dest_tx_hash)
  return {
    quoteId: asString(record.quoteId ?? record.id),
    status: asString(record.status),
    txHash: txHash || null,
    destTxHash: destTxHash || null,
    bridgeStatus: asString(record.bridgeStatus) || null,
    estimatedTimeSeconds: parseEstimatedSeconds(record.estimatedTimeSeconds ?? record.estimated_time_seconds),
    provider: asString(record.provider ?? record.bridge) || null,
  }
}

export function parseBridgeHistoryRow(row: unknown) {
  const record = asRecord(row) ?? {}
  const txHash = asString(record.txHash ?? record.tx_hash)
  const destTxHash = asString(record.destTxHash ?? record.dest_tx_hash)
  return {
    id: asString(record.id),
    originChainId: asNumber(record.originChainId ?? record.origin_chain_id, 0),
    destinationChainId: asNumber(record.destinationChainId ?? record.destination_chain_id, 0),
    status: asString(record.status),
    sellToken: asString(record.sellToken ?? record.sell_token),
    buyToken: asString(record.buyToken ?? record.buy_token),
    sellAmount: asString(record.sellAmount ?? record.sell_amount),
    buyAmount: asString(record.buyAmount ?? record.buy_amount),
    txHash: txHash || null,
    destTxHash: destTxHash || null,
    created: asString(record.created ?? record.createdAt ?? record.created_at),
  }
}

export { DEFAULT_SLIPPAGE_BPS, parseMinorAmount, parseSlippageBps, parseWei }
