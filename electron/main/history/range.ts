/**
 * 交易同步范围：首次只拉最近一页；已有记录则从最后区块往后。
 */
import { asRecord, asString } from '../backend/list'
import type { HistoryTxDraft } from './types'

export function buildAccountTxQuery(opts: {
  action: 'txlist' | 'tokentx'
  address: string
  startBlock: number | null
  chainId?: string
  page?: number
}): string {
  const incremental = opts.startBlock != null
  const page = opts.page ?? 1
  const offset = incremental ? 100 : 50
  const parts = [
    opts.chainId ? `chainid=${opts.chainId}` : '',
    'module=account',
    `action=${opts.action}`,
    `address=${opts.address}`,
    incremental ? `startblock=${opts.startBlock}` : '',
    incremental ? 'endblock=99999999' : '',
    `page=${page}`,
    `offset=${offset}`,
    `sort=${incremental ? 'asc' : 'desc'}`,
  ]
  return parts.filter(Boolean).join('&')
}

export function filterHistoryFromBlock(drafts: HistoryTxDraft[], startBlock: number | null): HistoryTxDraft[] {
  if (startBlock == null) return drafts
  return drafts.filter((item) => item.blockHeight == null || item.blockHeight >= startBlock)
}

export function isDeprecatedV1(payload: unknown): boolean {
  const root = asRecord(payload)
  const text = `${asString(root?.message)} ${asString(root?.result)}`
  return /deprecated v1|switch to etherscan api v2/i.test(text)
}

export function etherscanMessage(payload: unknown): string {
  const root = asRecord(payload)
  const result = asString(root?.result)
  const message = asString(root?.message)
  if (result && result !== message && !result.startsWith('[')) return result
  return message || '浏览器接口返回失败'
}

export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** 首次只扫最近一段；已有记录则从最后区块往后，超过上限只跟最近窗口。 */
export function historyBlockWindow(
  latest: number,
  startBlock: number | null,
  maxBlocks: number,
  firstSyncBlocks = Math.min(maxBlocks, 2_000),
): { from: number; to: number } {
  const to = Math.max(0, Math.floor(latest))
  const cap = Math.max(0, Math.floor(maxBlocks))
  if (startBlock == null) {
    const window = Math.max(0, Math.floor(firstSyncBlocks))
    return { from: Math.max(0, to - window), to }
  }
  const from = Math.max(0, Math.min(Math.floor(startBlock), to))
  if (to - from > cap) return { from: Math.max(0, to - cap), to }
  return { from, to }
}

export function nativeScanFrom(from: number, to: number, maxNativeBlocks: number): number {
  const cap = Math.max(1, Math.floor(maxNativeBlocks))
  return Math.max(from, to - cap + 1)
}

export function toBlockHex(block: number): string {
  return `0x${Math.max(0, Math.floor(block)).toString(16)}`
}

export function parseHexNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'bigint') return Number(value)
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = Number(BigInt(value))
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function topicAddress(address: string): string {
  return `0x${address.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}`
}

export function addressFromTopic(topic: string): string {
  const hex = topic.replace(/^0x/i, '').slice(-40)
  return `0x${hex.toLowerCase()}`
}
