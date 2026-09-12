/**
 * WalletConnect 的 ws 会自带 createConnection，传 agent 无效。
 * 这里提供自己的 createConnection：先 CONNECT / SOCKS，再 TLS。
 */
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import type { ParsedProxy } from './proxy'
import { activeProxyUrl, parseProxyUrl } from './proxy'

type ConnectOpts = {
  host?: string
  hostname?: string
  port?: number | string
  servername?: string
  rejectUnauthorized?: boolean
}

type ConnectCb = (err: Error | null, socket?: net.Socket | tls.TLSSocket) => void

function proxyAuthHeader(proxy: ParsedProxy): Record<string, string> {
  if (!proxy.username) return {}
  const token = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')
  return { 'Proxy-Authorization': `Basic ${token}` }
}

function destOf(options: ConnectOpts): { host: string; port: number } {
  return {
    host: options.host || options.hostname || '',
    port: Number(options.port) || 443,
  }
}

function tlsOn(socket: net.Socket, options: ConnectOpts, done: ConnectCb): void {
  const { host } = destOf(options)
  const tlsSocket = tls.connect(
    {
      socket,
      host,
      servername: options.servername || (net.isIP(host) ? undefined : host),
      rejectUnauthorized: options.rejectUnauthorized,
    },
    () => done(null, tlsSocket),
  )
  tlsSocket.once('error', done)
}

export function createWalletConnectConnection(options: ConnectOpts, callback?: ConnectCb): tls.TLSSocket | net.Socket | undefined {
  const done: ConnectCb = callback ?? (() => undefined)
  let parsed: ParsedProxy | null = null
  try {
    const raw = activeProxyUrl()
    parsed = raw ? parseProxyUrl(raw) : null
  } catch {
    parsed = null
  }
  if (!parsed) {
    const { host } = destOf(options)
    const socket = tls.connect({
      host,
      port: destOf(options).port,
      servername: options.servername || (net.isIP(host) ? '' : host),
      rejectUnauthorized: options.rejectUnauthorized,
    })
    if (callback) socket.once('secureConnect', () => callback(null, socket))
    socket.once('error', done)
    return socket
  }
  if (parsed.protocol.startsWith('socks')) {
    void socksConnect(parsed, destOf(options).host, destOf(options).port)
      .then((socket) => tlsOn(socket, options, done))
      .catch(done)
    return undefined
  }
  const { host, port } = destOf(options)
  const req = http.request({
    host: parsed.hostname,
    port: Number(parsed.port),
    method: 'CONNECT',
    path: `${host}:${port}`,
    headers: { Host: `${host}:${port}`, ...proxyAuthHeader(parsed) },
  })
  req.once('connect', (res, socket) => {
    if (res.statusCode !== 200) {
      socket.destroy()
      done(new Error(`代理 CONNECT 失败（${res.statusCode}）`))
      return
    }
    tlsOn(socket, options, done)
  })
  req.once('error', done)
  req.end()
  return undefined
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
    const onClose = () => finish(new Error('代理连接已关闭'))
    socket.on('data', onData)
    socket.once('error', onErr)
    socket.once('close', onClose)
  })
}

async function socksConnect(proxy: ParsedProxy, destHost: string, destPort: number): Promise<net.Socket> {
  const socket = net.connect(Number(proxy.port), proxy.hostname)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  const methods = proxy.username ? Buffer.from([0x05, 0x01, 0x02]) : Buffer.from([0x05, 0x01, 0x00])
  socket.write(methods)
  const greet = await readExact(socket, 2)
  if (greet[0] !== 0x05) throw new Error('SOCKS 代理握手失败')
  if (greet[1] === 0x02) {
    const user = Buffer.from(proxy.username)
    const pass = Buffer.from(proxy.password)
    socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
    const auth = await readExact(socket, 2)
    if (auth[1] !== 0x00) throw new Error('SOCKS 代理认证失败')
  } else if (greet[1] !== 0x00) {
    throw new Error('SOCKS 代理不支持当前认证方式')
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
  if (head[1] !== 0x00) throw new Error(`SOCKS 代理连接失败（${head[1]}）`)
  if (head[3] === 0x01) await readExact(socket, 6)
  else if (head[3] === 0x04) await readExact(socket, 18)
  else if (head[3] === 0x03) {
    const len = (await readExact(socket, 1))[0] ?? 0
    await readExact(socket, len + 2)
  }
  return socket
}
