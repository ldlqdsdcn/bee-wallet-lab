/**
 * CoinGecko 现货价格。Demo key 走 api.coingecko.com，失败时资产页仍显示链上余额。
 */
import { rawFetch } from '../backend/http'
import { coingeckoApiKey } from '../rpc/env'
import type { NetworkRecord, TokenRecord } from '@shared/types'

const CACHE_MS = 60_000
const SYMBOL_IDS: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  trx: 'tron',
  bnb: 'binancecoin',
  usdt: 'tether',
  usdc: 'usd-coin',
}

interface CacheEntry {
  at: number
  vs: string
  prices: Map<string, number>
}

let cache: CacheEntry | null = null

export function coinGeckoId(token: TokenRecord, network?: NetworkRecord | null): string | null {
  const fromToken = token.tokenId?.trim().toLowerCase() ?? ''
  if (fromToken && fromToken !== '0') return fromToken
  const fromNetwork = network?.coinId?.trim().toLowerCase() ?? ''
  if (!token.isToken && fromNetwork) return fromNetwork
  return SYMBOL_IDS[token.symbol.trim().toLowerCase()] ?? null
}

export function fiatValue(balance: string, price: number): string | null {
  const amount = Number(balance)
  if (!Number.isFinite(amount) || !Number.isFinite(price)) return null
  return (amount * price).toFixed(2)
}

function vsCurrency(code: string): string {
  const vs = code.trim().toLowerCase()
  return vs || 'usd'
}

export async function fetchCoinGeckoPrices(
  ids: string[],
  currencyCode: string,
  timeoutMs = 10_000,
): Promise<Map<string, number>> {
  const unique = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))]
  const vs = vsCurrency(currencyCode)
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

  const key = coingeckoApiKey()
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(unique.join(','))}&vs_currencies=${encodeURIComponent(vs)}`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key) headers['x-cg-demo-api-key'] = key

  const { status, body } = await rawFetch(url, { method: 'GET', headers }, timeoutMs)
  if (status < 200 || status >= 300) {
    throw new Error(`CoinGecko 返回 ${status}`)
  }
  if (!body || typeof body !== 'object') throw new Error('CoinGecko 响应无效')

  const prices = new Map<string, number>()
  for (const [id, quote] of Object.entries(body as Record<string, Record<string, unknown>>)) {
    const price = Number(quote?.[vs])
    if (Number.isFinite(price) && price >= 0) prices.set(id.toLowerCase(), price)
  }
  const next = new Map(cache?.vs === vs ? cache.prices : [])
  for (const [id, price] of prices) next.set(id, price)
  cache = { at: Date.now(), vs, prices: next }
  return prices
}
