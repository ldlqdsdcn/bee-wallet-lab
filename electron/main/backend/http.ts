/**
 * 目录 HTTP 底座：URL 拼接、超时、响应解包、错误归一。
 *
 * 目录站约定：
 *   业务成功  { success: true,  data, msg }
 *   业务失败  { success: false, data: null, msg }
 *   部分列表接口直接返回数组或裸对象
 */

export const DEFAULT_TIMEOUT_MS = 15_000

/** 后端返回的 401 业务码 */
export const AUTH_EXPIRED_CODES = [101, 102] as const

export class BackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly payload?: unknown,
  ) {
    super(message)
    this.name = 'BackendError'
  }
}

export type QueryValue = string | number | boolean | null | undefined

/**
 * 拼 URL。支持两种形态：
 *   绝对地址（http/https）直接用
 *   相对路径拼目录站 origin
 */
export function joinUrl(baseUrl: string, pathOrUrl: string): string {
  const target = pathOrUrl.trim()
  if (/^https?:\/\//i.test(target)) return target
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new BackendError('INVALID_BASE_URL', '目录站地址未配置')
  return `${base}/${target.replace(/^\/+/, '')}`
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue
    params.append(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export interface RawResponse {
  status: number
  body: unknown
}

export interface RawFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** 只做一次网络调用，不重试。超时与网络错误归一成 BackendError */
export async function rawFetch(
  url: string,
  init: RawFetchInit | RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RawResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        // 代理接口可能回纯文本（例如 BTC 广播返回 txid）
        body = text
      }
    }
    return { status: response.status, body }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new BackendError('TIMEOUT', `请求超时（${timeoutMs}ms）`)
    }
    throw new BackendError('NETWORK', err instanceof Error ? err.message : '网络请求失败')
  } finally {
    clearTimeout(timer)
  }
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

/** token 过期/无效判定：HTTP 401，或业务码命中 101/102 */
export function isAuthExpired(status: number, body: unknown): boolean {
  if (status === 401) return true
  const record = asRecord(body)
  if (!record) return false
  const code = record.code
  return typeof code === 'number' && (AUTH_EXPIRED_CODES as readonly number[]).includes(code)
}

function messageOf(body: unknown, fallback: string): string {
  const record = asRecord(body)
  if (!record) return typeof body === 'string' && body ? body : fallback
  for (const key of ['msg', 'message', 'error'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value) return value
  }
  return fallback
}

/**
 * 解包统一响应。
 * 有 success 字段的按 { success, data, msg } 处理；其余原样返回。
 */
export function unwrap<T>(status: number, body: unknown): T {
  if (isAuthExpired(status, body)) {
    throw new BackendError('AUTH_EXPIRED', messageOf(body, '登录已过期'), status, body)
  }
  if (status < 200 || status >= 300) {
    throw new BackendError(
      `HTTP_${status}`,
      messageOf(body, `后端返回 ${status}`),
      status,
      body,
    )
  }
  const record = asRecord(body)
  if (record && typeof record.success === 'boolean') {
    if (!record.success) {
      throw new BackendError('BACKEND_ERROR', messageOf(body, '后端处理失败'), status, body)
    }
    return record.data as T
  }
  return body as T
}
