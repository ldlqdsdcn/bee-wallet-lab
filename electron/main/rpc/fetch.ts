/**
 * 直连第三方 RPC / Esplora / TronGrid。不走公司后端、不注入 JWT。
 */
import { DEFAULT_TIMEOUT_MS, rawFetch } from '../backend/http'

export async function providerGet<T>(
  url: string,
  headers?: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const { status, body } = await rawFetch(url, { method: 'GET', headers }, timeoutMs)
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
    ...extra?.headers,
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
