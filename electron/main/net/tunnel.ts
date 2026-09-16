/**
 * 走 HTTP CONNECT / SOCKS 打出一条到目标主机的 TCP，再按需套 TLS。
 * WalletConnect 与代理探测共用，避免只测 CoinGecko 或只信 Chromium session。
 */
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
export type ProxyEndpoint = {
  protocol: string
  hostname: string
  port: string
  username: string
  password: string
}

export type TunnelStage = 'tcp' | 'handshake' | 'tls'

export class ProxyTunnelError extends Error {
  constructor(
    readonly stage: TunnelStage,
    message: string,
  ) {
    super(message)
    this.name = 'ProxyTunnelError'
  }
}

function proxyAuthHeader(proxy: ProxyEndpoint): Record<string, string> {
  if (!proxy.username) return {}
  const token = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')
  return { 'Proxy-Authorization': `Basic ${token}` }
}

function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return work(controller.signal).finally(() => clearTimeout(timer))
}

function abortError(): Error {
  return new ProxyTunnelError('tls', '代理隧道超时')
}

export async function openProxySocket(proxy: ProxyEndpoint, destHost: string, destPort: number): Promise<net.Socket> {
  if (proxy.protocol.startsWith('socks')) {
    return socksConnect(proxy, destHost, destPort)
  }
  return httpConnect(proxy, destHost, destPort)
}

export async function openProxyTls(
  proxy: ProxyEndpoint,
  destHost: string,
  destPort = 443,
  timeoutMs = 3_000,
): Promise<tls.TLSSocket> {
  return withTimeout(timeoutMs, async (signal) => {
    const raw = await openProxySocket(proxy, destHost, destPort)
    if (signal.aborted) {
      raw.destroy()
      throw abortError()
    }
    return await new Promise<tls.TLSSocket>((resolve, reject) => {
      const fail = (err: Error) => {
        raw.destroy()
        reject(err)
      }
      const onAbort = () => fail(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      const socket = tls.connect(
        {
          socket: raw,
          host: destHost,
          servername: net.isIP(destHost) ? undefined : destHost,
          rejectUnauthorized: false,
        },
        () => {
          signal.removeEventListener('abort', onAbort)
          resolve(socket)
        },
      )
      socket.once('error', (err) => {
        signal.removeEventListener('abort', onAbort)
        fail(err instanceof Error ? new ProxyTunnelError('tls', err.message) : new ProxyTunnelError('tls', 'TLS 失败'))
      })
    })
  })
}

/** 只验证代理是否真的能打出 HTTPS，不依赖 CoinGecko。 */
export async function probeProxyTunnel(proxy: ProxyEndpoint, timeoutMs = 3_000): Promise<{ ms: number }> {
  const started = Date.now()
  const socket = await openProxyTls(proxy, 'api.gateio.ws', 443, timeoutMs)
  socket.destroy()
  return { ms: Date.now() - started }
}

export function describeTunnelError(err: unknown): { stage: TunnelStage; message: string } {
  if (err instanceof ProxyTunnelError) {
    return { stage: err.stage, message: tunnelMessage(err.stage, err.message) }
  }
  const text = err instanceof Error ? err.message : String(err)
  const stage: TunnelStage =
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|connect/i.test(text) ? 'tcp' : /CONNECT|SOCKS|握手/i.test(text) ? 'handshake' : 'tls'
  return { stage, message: tunnelMessage(stage, text) }
}

export function tunnelMessage(stage: TunnelStage, detail: string): string {
  if (stage === 'tcp') return `无法连接代理端口（${detail}）`
  if (stage === 'handshake') return `代理握手失败（${detail}）`
  return `代理端口能连上，但没有转发 HTTPS（${detail}）。SpeedCat/Clash 若只开了 TUN，本地 7890/7892 会空转，请关掉应用内代理，或改用客户端真正提供转发的 mixed 端口`
}

function httpConnect(proxy: ProxyEndpoint, destHost: string, destPort: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxy.hostname,
      port: Number(proxy.port),
      method: 'CONNECT',
      path: `${destHost}:${destPort}`,
      headers: { Host: `${destHost}:${destPort}`, ...proxyAuthHeader(proxy) },
      timeout: 3_000,
    })
    req.once('timeout', () => {
      req.destroy()
      reject(new ProxyTunnelError('tcp', '连接代理超时'))
    })
    req.once('connect', (res, socket) => {
      req.setTimeout(0)
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new ProxyTunnelError('handshake', `CONNECT ${res.statusCode}`))
        return
      }
      resolve(socket)
    })
    req.once('error', (err) => {
      reject(new ProxyTunnelError('tcp', err.message))
    })
    req.end()
  })
}

function readExact(socket: net.Socket, size: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let got = 0
    const finish = (err?: Error) => {
      socket.off('data', onData)
      socket.off('error', onErr)
      socket.off('close', onClose)
      if (err) reject(err)
    }
    const onData = (buf: Buffer) => {
      chunks.push(buf)
      got += buf.length
      if (got < size) return
      finish()
      const all = Buffer.concat(chunks)
      if (all.length > size) socket.unshift(all.subarray(size))
      resolve(all.subarray(0, size))
    }
    const onErr = (err: Error) => finish(err)
    const onClose = () => finish(new ProxyTunnelError('handshake', '代理连接已关闭'))
    socket.on('data', onData)
    socket.once('error', onErr)
    socket.once('close', onClose)
  })
}

async function socksConnect(proxy: ProxyEndpoint, destHost: string, destPort: number): Promise<net.Socket> {
  const socket = net.connect({ port: Number(proxy.port), host: proxy.hostname })
  await new Promise<void>((resolve, reject) => {
    socket.setTimeout(3_000, () => {
      socket.destroy()
      reject(new ProxyTunnelError('tcp', '连接代理超时'))
    })
    socket.once('connect', () => {
      socket.setTimeout(0)
      resolve()
    })
    socket.once('error', (err) => reject(new ProxyTunnelError('tcp', err.message)))
  })
  const methods = proxy.username ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
  socket.write(methods)
  const greet = await readExact(socket, 2)
  if (greet[0] !== 0x05) throw new ProxyTunnelError('handshake', 'SOCKS 代理握手失败')
  if (greet[1] === 0x02) {
    const user = Buffer.from(proxy.username)
    const pass = Buffer.from(proxy.password)
    socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
    const auth = await readExact(socket, 2)
    if (auth[1] !== 0x00) throw new ProxyTunnelError('handshake', 'SOCKS 代理认证失败')
  } else if (greet[1] !== 0x00) {
    throw new ProxyTunnelError('handshake', 'SOCKS 代理不支持当前认证方式')
  }
  const host = Buffer.from(destHost)
  socket.write(
    Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
      host,
      Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff]),
    ]),
  )
  const head = await readExact(socket, 4)
  if (head[1] !== 0x00) throw new ProxyTunnelError('handshake', `SOCKS 代理连接失败（${head[1]}）`)
  if (head[3] === 0x01) await readExact(socket, 6)
  else if (head[3] === 0x04) await readExact(socket, 18)
  else if (head[3] === 0x03) {
    const len = (await readExact(socket, 1))[0] ?? 0
    await readExact(socket, len + 2)
  }
  return socket
}
