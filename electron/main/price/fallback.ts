/**
 * CoinGecko 不可达时的备用行情：Gate.io USDT 现货 + USD 汇率。
 * 本机访问 api.coingecko.com 经常超时，Gate / jsDelivr 通常可用。
 */
import { rawFetch } from '../backend/http'

const TICKER_TIMEOUT_MS = 6_000
const FX_TIMEOUT_MS = 6_000
const FX_CACHE_MS = 60 * 60_000

/** CoinGecko id -> Gate 交易对。USDT / 未知 id 不走交易对。 */
const GATE_PAIRS: Record<string, string> = {
  bitcoin: 'BTC_USDT',
  ethereum: 'ETH_USDT',
  solana: 'SOL_USDT',
  tron: 'TRX_USDT',
  binancecoin: 'BNB_USDT',
  'usd-coin': 'USDC_USDT',
}

const STABLE_IDS = new Set(['tether', 'usd-coin'])

interface FxCache {
  at: number
  rates: Record<string, number>
}

let fxCache: FxCache | null = null

export function gatePair(id: string): string | null {
  return GATE_PAIRS[id.trim().toLowerCase()] ?? null
}

export function quoteFromUsdt(usdtPrice: number, vs: string, usdRates: Record<string, number>): number | null {
  if (!Number.isFinite(usdtPrice) || usdtPrice < 0) return null
  const code = vs.trim().toLowerCase()
  if (!code || code === 'usd' || code === 'usdt') return usdtPrice
  const rate = usdRates[code]
  if (!Number.isFinite(rate) || rate <= 0) return null
  return usdtPrice * rate
}

interface GateTicker {
  last?: string
}

async function fetchTickerLast(pair: string): Promise<number> {
  const url = `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${encodeURIComponent(pair)}`
  const { status, body } = await rawFetch(url, { method: 'GET', headers: { Accept: 'application/json' } }, TICKER_TIMEOUT_MS)
  if (status < 200 || status >= 300) throw new Error(`Gate.io 返回 ${status}`)
  const row = Array.isArray(body) ? (body[0] as GateTicker | undefined) : null
  const last = Number(row?.last)
  if (!Number.isFinite(last) || last < 0) throw new Error(`Gate.io 无 ${pair} 报价`)
  return last
}

async function fetchUsdRates(): Promise<Record<string, number>> {
  if (fxCache && Date.now() - fxCache.at < FX_CACHE_MS) return fxCache.rates

  const jsdelivr =
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json'
  try {
    const { status, body } = await rawFetch(jsdelivr, { method: 'GET', headers: { Accept: 'application/json' } }, FX_TIMEOUT_MS)
    const usd = (body as { usd?: Record<string, unknown> } | null)?.usd
    if (status >= 200 && status < 300 && usd && typeof usd === 'object') {
      const rates = numericRates(usd)
      if (rates.cny || rates.jpy || rates.twd) {
        fxCache = { at: Date.now(), rates }
        return rates
      }
    }
  } catch {
    // 再试 exchangerate-api
  }

  const { status, body } = await rawFetch(
    'https://open.er-api.com/v6/latest/USD',
    { method: 'GET', headers: { Accept: 'application/json' } },
    FX_TIMEOUT_MS,
  )
  const table = (body as { rates?: Record<string, unknown> } | null)?.rates
  if (status < 200 || status >= 300 || !table) throw new Error('汇率接口不可达')
  const rates = numericRates(table)
  fxCache = { at: Date.now(), rates }
  return rates
}

function numericRates(input: Record<string, unknown>): Record<string, number> {
  const rates: Record<string, number> = {}
  for (const [key, value] of Object.entries(input)) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) rates[key.toLowerCase()] = n
  }
  return rates
}

export async function fetchFallbackPrices(ids: string[], vs: string): Promise<Map<string, number>> {
  const unique = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))]
  const code = vs.trim().toLowerCase() || 'usd'
  const needFx = code !== 'usd' && code !== 'usdt'
  const rates = needFx ? await fetchUsdRates() : { usd: 1 }

  const wanted = unique.filter((id) => gatePair(id) || STABLE_IDS.has(id))
  const pairs = [...new Set(wanted.map((id) => gatePair(id)).filter((pair): pair is string => Boolean(pair)))]
  const lastByPair = new Map<string, number>()
  const results = await Promise.allSettled(pairs.map(async (pair) => [pair, await fetchTickerLast(pair)] as const))
  for (const result of results) {
    if (result.status === 'fulfilled') lastByPair.set(result.value[0], result.value[1])
  }

  const prices = new Map<string, number>()
  for (const id of unique) {
    const usdt = id === 'tether' ? 1 : lastByPair.get(gatePair(id) ?? '')
    if (usdt == null) continue
    const fiat = quoteFromUsdt(usdt, code, rates)
    if (fiat == null) continue
    prices.set(id, fiat)
  }
  if (prices.size === 0) throw new Error('备用行情无可用报价')
  return prices
}
