/**
 * WalletConnect 的 ws 会自带 createConnection，传 agent 无效。
 * 这里提供自己的 createConnection：先走已生效的代理隧道，再 TLS。
 */
import net from 'node:net'
import tls from 'node:tls'
import { runtimeProxyUrl, parseProxyUrl } from './proxy'
import { openProxySocket } from './tunnel'

type ConnectOpts = {
  host?: string
  hostname?: string
  port?: number | string
  servername?: string
  rejectUnauthorized?: boolean
}

type ConnectCb = (err: Error | null, socket?: net.Socket | tls.TLSSocket) => void

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
  let parsed = null
  try {
    const raw = runtimeProxyUrl()
    parsed = raw ? parseProxyUrl(raw) : null
  } catch {
    parsed = null
  }
  if (!parsed) {
    const { host, port } = destOf(options)
    const socket = tls.connect({
      host,
      port,
      servername: options.servername || (net.isIP(host) ? '' : host),
      rejectUnauthorized: options.rejectUnauthorized,
    })
    if (callback) socket.once('secureConnect', () => callback(null, socket))
    socket.once('error', done)
    return socket
  }
  void openProxySocket(parsed, destOf(options).host, destOf(options).port)
    .then((socket) => tlsOn(socket, options, done))
    .catch(done)
  return undefined
}
