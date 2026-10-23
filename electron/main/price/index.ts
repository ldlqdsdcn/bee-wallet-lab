/**
 * 资产折算：CoinGecko 与 Gate 并行，交叉校验后再折算。
 */
import { fetchCoinGeckoPrices } from './coingecko'
import { fetchFallbackPrices } from './fallback'
import { pickMarketPrice } from './pick'

const CACHE_MS = 60_000
const GECKO_TIMEOUT_MS = 3_000
const GECKO_COOLDOWN_MS = 10 * 60_000

interface CacheEntry {
  at: number
  vs: string
  prices: Map<string, number>
}

let cache: CacheEntry | null = null
let geckoDownUntil = 0

export { coinGeckoId, fiatValue } from './coingecko'
export { pickMarketPrice } from './pick'

export function resetPriceBackoff(): void {
  cache = null
  geckoDownUntil = 0
}

export async function fetchMarketPrices(ids: string[], currencyCode: string): Promise<Map<string, number>> {
  const unique = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))]
  const vs = currencyCode.trim().toLowerCase() || 'usd'
  if (unique.length === 0) return new Map()

  if (cache && cache.vs === vs && Date.now() - cache.at < CACHE_MS) {
    const hit = new Map<string, number>()
    let missing = false
    for (const id of unique) {
      const price = cache.prices.get(id)
      if (price == null) missing = true
      else hit.set(id, price)
    }
    if (!missing) return hit
  }

  const geckoP =
    Date.now() >= geckoDownUntil
      ? fetchCoinGeckoPrices(unique, currencyCode, GECKO_TIMEOUT_MS).catch((err: unknown) => {
          geckoDownUntil = Date.now() + GECKO_COOLDOWN_MS
          console.warn('[price] CoinGecko 不可用，改用备用行情', err instanceof Error ? err.message : err)
          return null
        })
      : Promise.resolve(null)

  const fallbackP = fetchFallbackPrices(unique, vs).catch((err: unknown) => {
    console.warn('[price] 备用行情失败', err instanceof Error ? err.message : err)
    return null
  })

  const [gecko, fallback] = await Promise.all([geckoP, fallbackP])
  const prices = new Map<string, number>()
  for (const id of unique) {
    const price = pickMarketPrice(id, vs, gecko?.get(id), fallback?.get(id))
    if (price != null) prices.set(id, price)
  }
  if (prices.size === 0) throw new Error('行情源不可达，仅显示链上余额')
  cache = mergeCache(vs, prices)
  return prices
}

function mergeCache(vs: string, prices: Map<string, number>): CacheEntry {
  const next = new Map(cache?.vs === vs ? cache.prices : [])
  for (const [id, price] of prices) next.set(id, price)
  return { at: Date.now(), vs, prices: next }
}
