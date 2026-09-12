/**
 * 跨链桥目录站接口。路径与 bee-wallet-server SwapCrossApi 对齐。
 */
import { get, post } from '../backend/client'
import { extractList } from '../backend/list'
import {
  BRIDGE_API_PREFIX,
  parseBridgeHistoryRow,
  parseBridgeStatus,
  parseExecutableQuote,
  parsePriceResponse,
} from './codec'

const QUOTE_TIMEOUT_MS = 45_000

export async function fetchBridgePrice(query: Record<string, string | number>) {
  const data = await get<unknown>(`${BRIDGE_API_PREFIX}/price`, query, { timeoutMs: QUOTE_TIMEOUT_MS })
  return parsePriceResponse(data)
}

export async function fetchBridgeQuote(query: Record<string, string | number>) {
  const data = await get<unknown>(`${BRIDGE_API_PREFIX}/quote`, query, { timeoutMs: QUOTE_TIMEOUT_MS })
  return parseExecutableQuote(data)
}

export async function submitBridgeHash(input: { quoteId: string; txHash: string; originAddress: string }) {
  const data = await post<unknown>(`${BRIDGE_API_PREFIX}/submit`, input)
  return parseBridgeStatus(data)
}

export async function fetchBridgeOrderStatus(quoteId: string) {
  const data = await get<unknown>(`${BRIDGE_API_PREFIX}/status/${encodeURIComponent(quoteId)}`)
  return parseBridgeStatus(data)
}

export async function listBridgeOrders(address: string, originChainId: number) {
  const data = await get<unknown>(`${BRIDGE_API_PREFIX}/list/${encodeURIComponent(address)}`, {
    originChainId,
    limit: 30,
  })
  return extractList(data).map(parseBridgeHistoryRow)
}
