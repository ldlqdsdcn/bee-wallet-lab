/**
 * 合并 CoinGecko 与 Gate 报价。稳定币锚定 1 美元；两边差出 3 倍以上用现货。
 */
const STABLES = new Set(['tether', 'usd-coin'])
const OUTLIER_RATIO = 3
const STABLE_MIN = 0.92
const STABLE_MAX = 1.08

function inBand(price: number, min: number, max: number): boolean {
  return Number.isFinite(price) && price >= min && price <= max
}

export function pickMarketPrice(
  id: string,
  vs: string,
  gecko: number | undefined,
  fallback: number | undefined,
): number | undefined {
  const code = vs.trim().toLowerCase() || 'usd'
  const coin = id.trim().toLowerCase()

  if (STABLES.has(coin) && (code === 'usd' || code === 'usdt')) {
    if (gecko != null && inBand(gecko, STABLE_MIN, STABLE_MAX)) return gecko
    if (fallback != null && inBand(fallback, STABLE_MIN, STABLE_MAX)) return fallback
    return 1
  }

  if (gecko != null && fallback != null && gecko > 0 && fallback > 0) {
    const ratio = gecko / fallback
    if (ratio >= OUTLIER_RATIO || ratio <= 1 / OUTLIER_RATIO) return fallback
  }
  return gecko ?? fallback
}
