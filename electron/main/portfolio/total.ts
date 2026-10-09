/**
 * 把各代币的法币余额加总。取不到行情的条目不计入。
 */
import type { AssetEntry } from '@shared/types'

export function totalCurrencyOf(entries: AssetEntry[]): string | null {
  let sum = 0
  let priced = 0
  for (const item of entries) {
    if (item.currencyBalance == null) continue
    const value = Number(item.currencyBalance)
    if (!Number.isFinite(value)) continue
    sum += value
    priced += 1
  }
  return priced ? sum.toFixed(2) : null
}
