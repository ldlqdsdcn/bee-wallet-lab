/**
 * 直连第三方 RPC / Esplora / TronGrid。不走公司后端、不注入目录站 JWT。
 * 用户在节点维护里填的请求头会按 URL 自动带上。
 */
import { DEFAULT_TIMEOUT_MS, rawFetch } from '../backend/http'
import { listRpcHeaderBindings } from '../db/repos/rpcNodeRepo'
import { matchRpcHeaders } from '@shared/rpcHeaders'

function headersForUrl(url: string, extra?: Record<string, string>): Record<string, string> {
  try {
    return { ...matchRpcHeaders(url, listRpcHeaderBindings()), ...extra }
  } catch {
    return { ...extra }
  }
}

export async function providerGet<T>(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const { status, body } = await rawFetch(url, { method: 'GET', headers: headersForUrl(url, headers) }, timeoutMs)
  if (status < 200 || status >= 300) {
    throw new Error(`节点返回 ${status}`)
  }
  return body as T
}

export async function providerPost<T>(
  url: string,
  body: unknown,
  extra?: { headers?: Record<string, string>; rawBody?: string; timeoutMs?: number },
): Promise<T> {
  const headers = {
    'Content-Type': extra?.rawBody !== undefined ? 'text/plain' : 'application/json',
    ...headersForUrl(url, extra?.headers),
  }
  const { status, body: payload } = await rawFetch(
    url,
    {
      method: 'POST',
      headers,
      body: extra?.rawBody ?? JSON.stringify(body),
    },
    extra?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if (status < 200 || status >= 300) {
    const hint = typeof payload === 'string' ? payload.slice(0, 180) : ''
    throw new Error(hint || `节点返回 ${status}`)
  }
  return payload as T
}
