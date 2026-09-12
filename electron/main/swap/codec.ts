/**
 * 同网络兑换：链支持、代币占位、数量与报价解包。不发网络请求。
 */
import type { SwapKind } from '@shared/types'
import { asNumber, asRecord, asString } from '../backend/list'
import { formatMinor } from '../util/amount'

export const EVM_SWAP_CHAIN_IDS = [1, 56, 42161] as const
export const TRON_SWAP_CHAIN_ID = 195
export const EVM_NATIVE_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const TRON_NATIVE_PLACEHOLDER = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
export const DEFAULT_SLIPPAGE_BPS = 100

export function swapChainIdOf(input: {
  walletType: string
  networkScope: string
  chainId: string
}): number | null {
  if (input.walletType === 'tron' && input.networkScope === 'mainnet') return TRON_SWAP_CHAIN_ID
  if (input.walletType !== 'web3') return null
  const raw = input.chainId.trim()
  const id = /^0x/i.test(raw) ? Number.parseInt(raw, 16) : Number(raw)
  return (EVM_SWAP_CHAIN_IDS as readonly number[]).includes(id) ? id : null
}

export function swapKindOf(chainId: number): SwapKind {
  return chainId === TRON_SWAP_CHAIN_ID ? 'tron' : 'evm'
}

export function swapApiPrefix(kind: SwapKind): '/api/swap' | '/api/swapTron' {
  return kind === 'tron' ? '/api/swapTron' : '/api/swap'
}

export function tokenAddressForSwap(input: {
  kind: SwapKind
  isToken: boolean
  contractAddress: string | null
}): string {
  const contract = (input.contractAddress ?? '').trim()
  if (!input.isToken || !contract || contract === '0' || /^0x0+$/i.test(contract)) {
    return input.kind === 'tron' ? TRON_NATIVE_PLACEHOLDER : EVM_NATIVE_PLACEHOLDER
  }
  return contract
}

export function parseSlippageBps(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_SLIPPAGE_BPS
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error('滑点必须是 0–10000 的整数（基点）')
  return n
}

export function parseMinorAmount(value: unknown): bigint {
  const text = String(value ?? '').trim()
  if (!/^[0-9]+$/.test(text) || BigInt(text) <= 0n) throw new Error('兑换数量必须是大于 0 的最小单位整数')
  return BigInt(text)
}

export function parseWei(value: unknown): bigint {
  if (value == null || value === '') return 0n
  const text = String(value).trim()
  if (!text) return 0n
  if (/^0x[0-9a-fA-F]+$/i.test(text)) return BigInt(text)
  if (/^[0-9]+$/.test(text)) return BigInt(text)
  throw new Error(`无效金额：${value}`)
}

export function parseQuoteAmounts(data: unknown): {
  sellAmount: string
  buyAmount: string
  minBuyAmount: string
  sellToken: string
  buyToken: string
  allowanceTarget: string | null
  allowanceNeeded: boolean
  networkFeeWei: string | null
  nativeSymbol: string
  feeLimit: string | null
  energyNeeded: boolean
  energyQuantity: number
  burnIfNoRentSun: string | null
  transaction: Record<string, unknown> | null
  quoteId: string
  warnings: string[]
} {
  const record = asRecord(data)
  if (!record) throw new Error('询价响应无效')
  const issues = asRecord(record.issues)
  const gas = asRecord(record.gas)
  const energy = asRecord(record.energyRental)
  const tx = asRecord(record.transaction)
  const allowanceTarget = asString(record.allowanceTarget || issues?.spender || asRecord(issues?.allowance)?.spender)
  const allowanceNeeded = Boolean(issues?.allowance) && Boolean(allowanceTarget)
  const warnings: string[] = []
  if (asString(asRecord(issues?.balance)?.actual)) warnings.push('卖出代币余额可能不足')
  if (asString(asRecord(issues?.energy)?.message)) warnings.push(asString(asRecord(issues?.energy)?.message))
  if (record.liquidityAvailable === false) warnings.push('当前交易对流动性不足')
  return {
    sellAmount: asString(record.sellAmount),
    buyAmount: asString(record.buyAmount),
    minBuyAmount: asString(record.minBuyAmount || record.buyAmount),
    sellToken: asString(record.sellToken),
    buyToken: asString(record.buyToken),
    allowanceTarget: allowanceTarget || null,
    allowanceNeeded,
    networkFeeWei: asString(gas?.networkFeeWei) || null,
    nativeSymbol: asString(gas?.nativeSymbol, 'ETH'),
    feeLimit: asString(gas?.feeLimit || tx?.feeLimit) || null,
    energyNeeded: Boolean(energy?.needed),
    energyQuantity: asNumber(energy?.quantity, 0),
    burnIfNoRentSun: asString(energy?.burnIfNoRentSun || gas?.networkFeeWei) || null,
    transaction: tx,
    quoteId: asString(record.quoteId || record.id),
    warnings,
  }
}

export function formatSwapFee(networkFeeWei: string | null, decimals: number, symbol: string): string {
  if (!networkFeeWei) return `网络费待上链时确定 · ${symbol}`
  return `约 ${formatMinor(parseWei(networkFeeWei), decimals)} ${symbol}`
}

export function parseHistoryRow(row: unknown): {
  id: string
  chainId: number
  status: string
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  txHash: string | null
  created: string
} {
  const record = asRecord(row) ?? {}
  const txHash = asString(record.txHash ?? record.tx_hash)
  return {
    id: asString(record.id),
    chainId: asNumber(record.chainId ?? record.chain_id, 0),
    status: asString(record.status),
    sellToken: asString(record.sellToken ?? record.sell_token),
    buyToken: asString(record.buyToken ?? record.buy_token),
    sellAmount: asString(record.sellAmount ?? record.sell_amount),
    buyAmount: asString(record.buyAmount ?? record.buy_amount),
    txHash: txHash || null,
    created: asString(record.created ?? record.created_at),
  }
}
