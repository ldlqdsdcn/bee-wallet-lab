/**
 * 应用级 HTTP/SOCKS 代理。走 Electron session，rawFetch / 节点 / 行情都会用到。
 */
import type { ProxyTestResult } from '@shared/types'
import { loadSettings } from '../db/repos/metaRepo'
import { selectedProxy } from '../db/repos/proxyRepo'

const BYPASS = 'localhost,127.0.0.1,[::1],<local>'
const ALLOWED = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:'])

export interface ParsedProxy {
  href: string
  protocol: string
  hostname: string
  port: string
  username: string
  password: string
}

let proxyAuth: { username: string; password: string } | null = null
let loginHooked = false

export function parseProxyUrl(raw: string): ParsedProxy | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const input = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('代理地址格式无效')
  }
  let protocol = url.protocol.toLowerCase()
  if (!ALLOWED.has(protocol)) throw new Error('仅支持 http / https / socks5 代理')
  if (protocol === 'socks:') protocol = 'socks5:'
  if (!url.hostname) throw new Error('代理地址缺少主机名')
  const port = url.port || defaultPort(protocol)
  return {
    href: `${protocol}//${url.hostname}:${port}`,
    protocol,
    hostname: url.hostname,
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}

export function serializeProxy(parsed: ParsedProxy): string {
  if (!parsed.username) return parsed.href
  const user = encodeURIComponent(parsed.username)
  const pass = encodeURIComponent(parsed.password)
  return `${parsed.protocol}//${user}:${pass}@${parsed.hostname}:${parsed.port}`
}

export function normalizeProxyUrl(raw: string): string {
  const parsed = parseProxyUrl(raw)
  return parsed ? serializeProxy(parsed) : ''
}

export function displayProxyUrl(raw: string): string {
  try {
    const parsed = parseProxyUrl(raw)
    if (!parsed) return raw
    if (!parsed.username) return parsed.href
    return `${parsed.protocol}//${parsed.username}:***@${parsed.hostname}:${parsed.port}`
  } catch {
    return raw
  }
}

function defaultPort(protocol: string): string {
  if (protocol === 'https:') return '443'
  if (protocol === 'http:') return '80'
  return '1080'
}

async function loadElectron(): Promise<typeof import('electron') | null> {
  try {
    return await import('electron')
  } catch {
    return null
  }
}

function ensureLoginHook(electron: typeof import('electron')): void {
  if (loginHooked) return
  loginHooked = true
  electron.app.on('login', (event, _contents, _details, authInfo, callback) => {
    if (!authInfo.isProxy || !proxyAuth) return
    event.preventDefault()
    callback(proxyAuth.username, proxyAuth.password)
  })
}

export async function applyAppProxy(proxyUrl: string): Promise<void> {
  const electron = await loadElectron()
  if (!electron?.session) return
  const parsed = parseProxyUrl(proxyUrl)
  proxyAuth = parsed?.username ? { username: parsed.username, password: parsed.password } : null
  ensureLoginHook(electron)
  const ses = electron.session.defaultSession
  if (!parsed) {
    await ses.setProxy({ mode: 'direct', proxyBypassRules: BYPASS })
  } else {
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: parsed.href,
      proxyBypassRules: BYPASS,
    })
  }
  await ses.closeAllConnections()
}

export function activeProxyUrl(): string {
  if (!loadSettings().proxyEnabled) return ''
  return selectedProxy()?.url ?? ''
}

export async function applyActiveProxy(): Promise<void> {
  await applyAppProxy(activeProxyUrl())
}

export async function proxiedFetch(url: string, init: RequestInit): Promise<Response> {
  const electron = await loadElectron()
  if (electron?.net?.fetch) {
    return electron.net.fetch(url, init)
  }
  return fetch(url, init)
}

async function probe(url: string, timeoutMs: number): Promise<{ ok: boolean; ms: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await proxiedFetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    return { ok: response.ok, ms: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

export async function probeProxy(proxyUrl: string): Promise<ProxyTestResult> {
  const normalized = normalizeProxyUrl(proxyUrl)
  if (!normalized) throw new Error('代理地址不能为空')
  await applyAppProxy(normalized)
  try {
    try {
      const gecko = await probe('https://api.coingecko.com/api/v3/ping', 8_000)
      if (gecko.ok) {
        return { ok: true, latencyMs: gecko.ms, message: `CoinGecko 可达（${gecko.ms} ms）` }
      }
    } catch {
      /* 再试 Gate */
    }
    try {
      const gate = await probe('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=ETH_USDT', 6_000)
      if (gate.ok) {
        return {
          ok: true,
          latencyMs: gate.ms,
          message: `代理可用（Gate.io ${gate.ms} ms），CoinGecko 仍不可达`,
        }
      }
    } catch {
      /* 两边都失败 */
    }
    return { ok: false, latencyMs: null, message: '代理不可达或探测超时' }
  } finally {
    await applyActiveProxy()
  }
}
