/**
 * 同网络兑换目录站接口。路径与 bee-wallet-server SwapApi / SwapTronApi 对齐。
 */
import type { SwapKind } from '@shared/types'
import { get, post } from '../backend/client'
import { extractList } from '../backend/list'
import { parseHistoryRow, parseQuoteAmounts, swapApiPrefix } from './codec'

export async function fetchSwapPrice(kind: SwapKind, query: Record<string, string | number>) {
  const data = await get<unknown>(`${swapApiPrefix(kind)}/price`, query)
  return parseQuoteAmounts(data)
}

export async function fetchSwapQuote(kind: SwapKind, query: Record<string, string | number>) {
  const data = await get<unknown>(`${swapApiPrefix(kind)}/quote`, query)
  const parsed = parseQuoteAmounts(data)
  if (!parsed.quoteId) throw new Error('报价未返回 quoteId')
  if (kind === 'evm' && !parsed.transaction) throw new Error('报价未返回待签名交易')
  if (kind === 'tron' && !parsed.transaction) throw new Error('报价未返回波场待签名交易')
  return parsed
}

export async function submitSwapHash(
  kind: SwapKind,
  input: { quoteId: string; txHash: string; taker: string },
): Promise<unknown> {
  return post<unknown>(`${swapApiPrefix(kind)}/submit`, input)
}

export async function listSwapOrders(kind: SwapKind, address: string, chainId: number) {
  const data = await get<unknown>(`${swapApiPrefix(kind)}/list/${encodeURIComponent(address)}`, {
    chainId,
    limit: 30,
  })
  return extractList(data).map(parseHistoryRow)
}
