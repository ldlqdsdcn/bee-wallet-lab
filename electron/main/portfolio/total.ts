/**
 * 把各代币的法币余额加总。取不到行情的条目不计入。
 */
import type { AssetEntry } from '@shared/types'

export function totalCurrencyOf(entries: AssetEntry[]): string | null {
  let cents = 0
  let priced = 0
  for (const item of entries) {
    if (item.currencyBalance == null) continue
    const value = Number(item.currencyBalance)
    if (!Number.isFinite(value)) continue
    cents += Math.round(value * 100)
    priced += 1
  }
  return priced ? (cents / 100).toFixed(2) : null
}
