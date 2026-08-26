/**
 * 后端列表解包。网络 / 代币 / 法币接口有的直接回数组，
 * 有的包一层 { data | list | records | rows }。
 */
export function extractList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (typeof payload === 'string') {
    try {
      return extractList<T>(JSON.parse(payload) as unknown)
    } catch {
      return []
    }
  }
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  for (const key of ['data', 'list', 'records', 'rows'] as const) {
    const value = record[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    return text || fallback
  }
  return fallback
}

export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function asBooleanFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'y' || normalized === '1' || normalized === 'true'
  }
  return false
}
