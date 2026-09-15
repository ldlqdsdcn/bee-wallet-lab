export function uniquePayersByAddress<T extends { address: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = item.address.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export function matchAddressKeyword(address: string, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return address.toLowerCase().includes(kw)
}

export function matchBalanceRange(balance: string | null | undefined, minRaw: string, maxRaw: string): boolean {
  if (!minRaw.trim() && !maxRaw.trim()) return true
  if (balance == null || balance === '') return false
  const value = Number(balance)
  if (!Number.isFinite(value)) return false
  if (minRaw.trim()) {
    const min = Number(minRaw)
    if (Number.isFinite(min) && value < min) return false
  }
  if (maxRaw.trim()) {
    const max = Number(maxRaw)
    if (Number.isFinite(max) && value > max) return false
  }
  return true
}
