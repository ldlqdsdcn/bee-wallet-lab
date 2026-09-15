/**
 * 自定义 RPC 请求头：一行一个 `Name: value`，也认 curl 的 `-H`。
 * 值由用户自己填，主进程请求时带上，不写进日志。
 */

const FORBIDDEN = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'cookie',
  'set-cookie',
  'cookie2',
])

const NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function parseRpcHeaders(text: string): Record<string, string> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  if (trimmed.startsWith('{')) return parseJsonHeaders(trimmed)

  const out: Record<string, string> = {}
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = unwrapCurlHeader(rawLine.trim())
    if (!line || line.startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep <= 0) throw new Error(`请求头格式无效：${rawLine.trim()}`)
    const name = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    setHeader(out, name, value)
  }
  return out
}

export function serializeRpcHeaders(headers: Record<string, string> | null | undefined): string {
  if (!headers) return ''
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

export function rpcHeaderNames(headers: Record<string, string> | null | undefined): string[] {
  return headers ? Object.keys(headers) : []
}

export function matchRpcHeaders(
  requestUrl: string,
  bindings: Array<{ url: string; headers: Record<string, string> }>,
): Record<string, string> | undefined {
  const target = stripSlash(requestUrl)
  if (!target) return undefined
  let best: { base: string; headers: Record<string, string> } | undefined
  for (const row of bindings) {
    const base = stripSlash(row.url)
    if (!base || !Object.keys(row.headers).length) continue
    if (target === base || target.startsWith(`${base}/`)) {
      if (!best || base.length > best.base.length) best = { base, headers: row.headers }
    }
  }
  return best?.headers
}

function parseJsonHeaders(text: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('请求头 JSON 无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请求头 JSON 必须是对象')
  }
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new Error(`请求头 ${name} 的值必须是字符串`)
    setHeader(out, name, value)
  }
  return out
}

function unwrapCurlHeader(line: string): string {
  const match = line.match(/^-H\s+(.+)$/i)
  if (!match) return line
  const raw = match[1].trim()
  if (
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith('"') && raw.endsWith('"'))
  ) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function setHeader(out: Record<string, string>, name: string, value: string): void {
  if (!NAME_RE.test(name)) throw new Error(`请求头名称无效：${name}`)
  if (FORBIDDEN.has(name.toLowerCase())) throw new Error(`不允许设置请求头 ${name}`)
  if (!value) throw new Error(`请求头 ${name} 的值不能为空`)
  const existing = Object.keys(out).find((key) => key.toLowerCase() === name.toLowerCase())
  if (existing) delete out[existing]
  out[name] = value
}

function stripSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}
