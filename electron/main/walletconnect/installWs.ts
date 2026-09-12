/**
 * 必须在 @walletconnect/* 求值之前执行：jsonrpc-ws-connection 会缓存 WebSocket。
 * Electron 主进程自带的 WebSocket 不走代理；ws 的 agent 选项也会被自带的 createConnection 盖掉。
 */
import WS from 'ws'
import { activeProxyUrl, displayProxyUrl } from '../net/proxy'
import { createWalletConnectConnection } from '../net/wsAgent'

const Base = (WS as unknown as { default?: typeof WS }).default ?? WS

class BeeWebSocket extends (Base as typeof WS) {
  constructor(url: string | URL, protocols?: string | string[], options?: object) {
    super(url, protocols ?? [], {
      ...(options && typeof options === 'object' ? options : {}),
      createConnection: createWalletConnectConnection,
    })
  }
}

export function installWalletConnectWebSocket(): typeof globalThis.WebSocket {
  process.env.NODE_USE_ENV_PROXY = '1'
  globalThis.WebSocket = BeeWebSocket as unknown as typeof globalThis.WebSocket
  try {
    const proxy = activeProxyUrl()
    console.log(
      '[walletconnect] WebSocket 已接管',
      proxy ? `代理 ${displayProxyUrl(proxy)}` : '直连（未开代理）',
    )
  } catch {
    console.log('[walletconnect] WebSocket 已接管')
  }
  return globalThis.WebSocket
}

installWalletConnectWebSocket()
