/**
 * 应用级 HTTP/SOCKS 代理。走 Electron session，rawFetch / 节点 / 行情都会用到。
 */
import type { ProxyTestResult } from '@shared/types'
import { loadSettings } from '../db/repos/metaRepo'
import { selectedProxy } from '../db/repos/proxyRepo'
import { describeTunnelError, probeProxyTunnel } from './tunnel'

const BYPASS = 'localhost,127.0.0.1,[::1],<local>'
const ALLOWED = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:'])
const TUNNEL_TIMEOUT_MS = 3_000

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
/** 真正套到 session / WalletConnect 上的代理；隧道空转时为 null，避免把整站流量送进死端口。 */
let runtimeProxy: ParsedProxy | null = null

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

export function electronProxyRules(parsed: ParsedProxy): string {
  const server = `${parsed.hostname}:${parsed.port}`
  if (parsed.protocol === 'https:') return `https://${server}`
  if (parsed.protocol.startsWith('socks4')) return `socks4://${server}`
  if (parsed.protocol.startsWith('socks')) return `socks5://${server}`
  return `http=${server};https=${server}`
}

function applyNodeProxyEnv(parsed: ParsedProxy | null): void {
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']
  for (const key of keys) delete process.env[key]
  if (!parsed) return
  const href = serializeProxy(parsed)
  if (parsed.protocol.startsWith('socks')) {
    process.env.ALL_PROXY = href
    process.env.all_proxy = href
    return
  }
  process.env.HTTP_PROXY = href
  process.env.HTTPS_PROXY = href
  process.env.ALL_PROXY = href
  process.env.http_proxy = href
  process.env.https_proxy = href
  process.env.all_proxy = href
}

async function setSessionProxy(parsed: ParsedProxy | null): Promise<void> {
  const electron = await loadElectron()
  if (!electron?.session) {
    runtimeProxy = parsed
    applyNodeProxyEnv(parsed)
    return
  }
  ensureLoginHook(electron)
  const ses = electron.session.defaultSession
  applyNodeProxyEnv(parsed)
  runtimeProxy = parsed
  if (!parsed) {
    await ses.setProxy({ mode: 'direct', proxyBypassRules: BYPASS })
  } else {
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules: electronProxyRules(parsed),
      proxyBypassRules: BYPASS,
    })
  }
  await ses.closeAllConnections()
}

export async function applyAppProxy(proxyUrl: string): Promise<string | null> {
  const parsed = parseProxyUrl(proxyUrl)
  proxyAuth = parsed?.username ? { username: parsed.username, password: parsed.password } : null
  if (!parsed) {
    await setSessionProxy(null)
    return null
  }
  try {
    await probeProxyTunnel(parsed, TUNNEL_TIMEOUT_MS)
  } catch (err) {
    const { message } = describeTunnelError(err)
    console.warn('[proxy] 隧道失败，已回退直连', displayProxyUrl(parsed.href), message)
    await setSessionProxy(null)
    return message
  }
  await setSessionProxy(parsed)
  console.log('[proxy] 已启用', displayProxyUrl(parsed.href))
  return null
}

export function activeProxyUrl(): string {
  if (!loadSettings().proxyEnabled) return ''
  return selectedProxy()?.url ?? ''
}

export function runtimeProxyUrl(): string {
  return runtimeProxy ? serializeProxy(runtimeProxy) : ''
}

export async function applyActiveProxy(): Promise<string | null> {
  return applyAppProxy(activeProxyUrl())
}

export async function proxiedFetch(url: string, init: RequestInit): Promise<Response> {
  const electron = await loadElectron()
  if (electron?.net?.fetch) {
    return electron.net.fetch(url, init)
  }
  return fetch(url, init)
}

export async function probeProxy(proxyUrl: string): Promise<ProxyTestResult> {
  const normalized = normalizeProxyUrl(proxyUrl)
  if (!normalized) throw new Error('代理地址不能为空')
  const parsed = parseProxyUrl(normalized)
  if (!parsed) throw new Error('代理地址不能为空')
  try {
    const tunnel = await probeProxyTunnel(parsed, TUNNEL_TIMEOUT_MS)
    return { ok: true, latencyMs: tunnel.ms, message: `代理可用（${tunnel.ms} ms）` }
  } catch (err) {
    const { message } = describeTunnelError(err)
    return { ok: false, latencyMs: null, message }
  }
}
