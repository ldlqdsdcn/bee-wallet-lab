/**
 * 资产折算：优先 CoinGecko；本机连不上时并行改用 Gate.io。
 */
import { fetchCoinGeckoPrices } from './coingecko'
import { fetchFallbackPrices } from './fallback'

const CACHE_MS = 60_000
const GECKO_TIMEOUT_MS = 3_000
const GECKO_WAIT_MS = 400
const GECKO_COOLDOWN_MS = 10 * 60_000

interface CacheEntry {
  at: number
  vs: string
  prices: Map<string, number>
}

let cache: CacheEntry | null = null
let geckoDownUntil = 0

export { coinGeckoId, fiatValue } from './coingecko'

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
      ? fetchCoinGeckoPrices(unique, currencyCode, GECKO_TIMEOUT_MS)
          .then((prices) => prices)
          .catch((err: unknown) => {
            geckoDownUntil = Date.now() + GECKO_COOLDOWN_MS
            console.warn('[price] CoinGecko 不可用，改用备用行情', err instanceof Error ? err.message : err)
            return null
          })
      : Promise.resolve(null)

  const fallbackP = fetchFallbackPrices(unique, vs).catch((err: unknown) => {
    console.warn('[price] 备用行情失败', err instanceof Error ? err.message : err)
    return null
  })

  const geckoQuick = await Promise.race([geckoP, sleep(GECKO_WAIT_MS).then(() => 'slow' as const)])
  if (geckoQuick && geckoQuick !== 'slow' && geckoQuick.size > 0) {
    cache = mergeCache(vs, geckoQuick)
    return geckoQuick
  }

  const fallback = await fallbackP
  if (fallback && fallback.size > 0) {
    cache = mergeCache(vs, fallback)
    return fallback
  }

  const geckoLate = geckoQuick === 'slow' ? await geckoP : geckoQuick
  if (geckoLate && geckoLate.size > 0) {
    cache = mergeCache(vs, geckoLate)
    return geckoLate
  }
  throw new Error('行情源不可达，仅显示链上余额')
}

function mergeCache(vs: string, prices: Map<string, number>): CacheEntry {
  const next = new Map(cache?.vs === vs ? cache.prices : [])
  for (const [id, price] of prices) next.set(id, price)
  return { at: Date.now(), vs, prices: next }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
