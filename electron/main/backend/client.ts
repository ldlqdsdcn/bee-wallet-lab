/**
 * 后端请求客户端：统一注入 x-api-key、401 自动换 token 重试一次、GET 并发去重。
 *
 * 去重只对 GET 生效：同一时刻对同一 URL 的重复 GET 共享一个在途请求，
 * 首页展开 BTC 四个变体时会大量出现这种情况。POST 有副作用，绝不去重。
 */
import type { BackendStatus } from '@shared/types'
import {
  currentToken,
  getToken,
  invalidateToken,
  peekAuthAddress,
  resetAuthState,
} from './auth'
import { getBaseUrl, getLanguage } from './config'
import {
  BackendError,
  DEFAULT_TIMEOUT_MS,
  buildQuery,
  joinUrl,
  rawFetch,
  unwrap,
  type QueryValue,
} from './http'

/** 探活用的短超时，不必等满 15 秒 */
const PING_TIMEOUT_MS = 5_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  query?: Record<string, QueryValue>
  body?: unknown
  /** 不走 JSON.stringify，用于 BTC 广播这类 text/plain */
  rawBody?: string
  headers?: Record<string, string>
  timeoutMs?: number
  /** 不注入 x-api-key */
  anonymous?: boolean
  /** 关闭 GET 去重（需要强制拿最新数据时用） */
  noDedupe?: boolean
}

const inflightGets = new Map<string, Promise<unknown>>()

function headersFor(token: string | null, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': extra?.['Content-Type'] ?? 'application/json;charset=UTF-8',
    // 后端 token 详情支持 i18n，预留
    'x-language': getLanguage(),
  }
  if (token) headers['x-api-key'] = token
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) headers[key] = value
    }
  }
  return headers
}

async function callOnce<T>(url: string, options: RequestOptions, token: string | null): Promise<T> {
  const method = options.method ?? 'GET'
  const hasBody = method !== 'GET' && (options.rawBody !== undefined || options.body !== undefined)
  const { status, body } = await rawFetch(
    url,
    {
      method,
      headers: headersFor(token, options.headers),
      body: hasBody ? (options.rawBody ?? JSON.stringify(options.body)) : undefined,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  return unwrap<T>(status, body)
}

async function execute<T>(options: RequestOptions): Promise<T> {
  const baseUrl = getBaseUrl()
  const url = `${joinUrl(baseUrl, options.path)}${buildQuery(options.query)}`

  if (options.anonymous) {
    return callOnce<T>(url, options, null)
  }

  const token = await getToken()
  try {
    return await callOnce<T>(url, options, token)
  } catch (err) {
    if (!(err instanceof BackendError) || err.code !== 'AUTH_EXPIRED') throw err
    // token 过期或无效：清缓存、强制换新，只重试一次
    invalidateToken()
    let fresh: string
    try {
      fresh = await getToken({ force: true })
    } catch (refreshErr) {
      if (refreshErr instanceof BackendError) throw refreshErr
      throw new BackendError('AUTH_EXPIRED', '登录已过期且无法自动续期，请解锁钱包后重试')
    }
    return callOnce<T>(url, options, fresh)
  }
}

export async function request<T>(options: RequestOptions): Promise<T> {
  const method = options.method ?? 'GET'
  if (method !== 'GET' || options.noDedupe) {
    return execute<T>(options)
  }

  const key = `${getBaseUrl()}|GET|${options.path}${buildQuery(options.query)}`
  const existing = inflightGets.get(key)
  if (existing) return existing as Promise<T>

  const pending = execute<T>(options).finally(() => {
    inflightGets.delete(key)
  })
  inflightGets.set(key, pending)
  return pending
}

export function get<T>(
  path: string,
  query?: Record<string, QueryValue>,
  extra?: Omit<RequestOptions, 'method' | 'path' | 'query'>,
): Promise<T> {
  return request<T>({ ...extra, method: 'GET', path, query })
}

export function post<T>(
  path: string,
  body?: unknown,
  extra?: Omit<RequestOptions, 'method' | 'path' | 'body'>,
): Promise<T> {
  return request<T>({ ...extra, method: 'POST', path, body })
}

/**
 * 目录站拉取。先匿名；若对方仍要 JWT（过渡期公司 API）再带 token 重试一次。
 */
export async function catalogGet<T>(
  path: string,
  query?: Record<string, QueryValue>,
  extra?: Omit<RequestOptions, 'method' | 'path' | 'query'>,
): Promise<T> {
  try {
    return await request<T>({ ...extra, method: 'GET', path, query, anonymous: true })
  } catch (err) {
    if (err instanceof BackendError && (err.code === 'AUTH_EXPIRED' || err.status === 401)) {
      return await request<T>({ ...extra, method: 'GET', path, query })
    }
    throw err
  }
}

/**
 * 探活。只要后端有响应就算可达（不关心状态码），
 * 因为根路径在有无鉴权、有无反向代理时返回码并不一致。
 */
export async function ping(): Promise<boolean> {
  try {
    await rawFetch(joinUrl(getBaseUrl(), '/'), { method: 'GET' }, PING_TIMEOUT_MS)
    return true
  } catch {
    return false
  }
}

/** 状态查询不主动换 token，避免打开设置页就触发一次签名 */
export async function getBackendStatus(): Promise<BackendStatus> {
  const baseUrl = getBaseUrl()
  const token = currentToken()
  const authAddress = peekAuthAddress()
  const reachable = await ping()
  let message: string | null = null
  if (!reachable) {
    message = '目录服务不可达，正在使用本地缓存'
  } else {
    message = '链上请求直连 Infura / Blockstream / TronGrid，本地址只提供网络与代币列表'
  }
  return {
    baseUrl,
    reachable,
    authAddress,
    authenticated: Boolean(token),
    tokenExpiresAt: token?.expiresAt ?? null,
    message,
  }
}

/** 主动登录（设置页按钮用）。返回鉴权地址 */
export async function authenticate(): Promise<BackendStatus> {
  await getToken({ force: true })
  return getBackendStatus()
}

/** baseUrl 变更或锁定退出时调用：丢掉在途请求与内存 token */
export function resetBackend(): void {
  inflightGets.clear()
  resetAuthState()
}
