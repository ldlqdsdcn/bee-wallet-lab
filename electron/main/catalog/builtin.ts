/**
 * 第一版内置目录：从打包进主进程的 JSON 装入 SQLite。
 * 数据来自 onewallet-app 的 defaultNetworks / defaultTokens，不请求后台。
 */
import { asRecord, extractList } from '../backend/list'
import rawCurrencies from '../../../data/catalog/currencies.json'
import rawNetworks from '../../../data/catalog/networks.json'
import rawTokens from '../../../data/catalog/tokens.json'
import { mapCurrency, mapNetwork, mapToken } from './map'
import type { CurrencyRecord, NetworkRecord, TokenRecord } from '@shared/types'

function mapList<T>(
  raw: unknown,
  map: (dto: Record<string, unknown>, syncedAt: number) => T | null,
  syncedAt: number,
): T[] {
  return extractList<unknown>(raw)
    .map((item) => map(asRecord(item) ?? {}, syncedAt))
    .filter((item): item is T => item !== null)
}

export function loadBuiltinCatalog(syncedAt = Date.now()): {
  networks: NetworkRecord[]
  tokens: TokenRecord[]
  currencies: CurrencyRecord[]
} {
  return {
    networks: mapList(rawNetworks, mapNetwork, syncedAt),
    tokens: mapList(rawTokens, mapToken, syncedAt),
    currencies: mapList(rawCurrencies, mapCurrency, syncedAt),
  }
}
