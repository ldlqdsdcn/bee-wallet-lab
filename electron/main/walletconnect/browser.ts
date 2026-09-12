/**
 * 应用内浏览器：注入 EIP-1193 / EIP-6963。
 * 只截网站自己打开的 wc: 深链接，不扫页面、不抢剪贴板。
 */
import { clipboard, protocol as defaultProtocol, type Event, type Session, type WebContents } from 'electron'
import { DAPP_DEEP_LINK_INJECT, DAPP_PROVIDER_INJECT } from '../../dapp-inject'
import { extractWalletConnectUri, findWalletConnectDeepLink } from './codec'
import { acceptWalletConnectDeepLink } from './service'

const WC_SCHEMES = ['wc', 'walletconnect', 'bee-wallet'] as const

export { findWalletConnectDeepLink }

export function isWalletConnectUrl(url: string): boolean {
  return Boolean(extractWalletConnectUri(url)?.includes('symKey='))
}

export async function readWalletConnectClipboard(): Promise<string> {
  try {
    return String((await clipboard.readText()) ?? '')
  } catch {
    return ''
  }
}

function captureDeepLink(raw: string): boolean {
  if (!isWalletConnectUrl(raw)) return false
  void acceptWalletConnectDeepLink(raw)
  return true
}

export function installWalletConnectProtocol(ses?: Session): void {
  const target = ses?.protocol ?? defaultProtocol
  const handle = (request: Request) => {
    captureDeepLink(request.url)
    return new Response('', { status: 204 })
  }
  for (const scheme of WC_SCHEMES) {
    try {
      target.handle(scheme, handle)
    } catch {
      /* 重复注册时跳过 */
    }
  }
}

export function startWalletConnectClipboardWatch(): void {
  /* 剪贴板只给 WalletConnect 页手动粘贴用 */
}

export function stopWalletConnectClipboardWatch(): void {
  /* no-op */
}

export function attachWalletConnectCapture(contents: WebContents): void {
  contents.on('console-message', (...args: unknown[]) => {
    const text = args
      .flatMap((item) => {
        if (typeof item === 'string') return [item]
        if (item && typeof item === 'object' && 'message' in item && typeof item.message === 'string') return [item.message]
        return []
      })
      .join(' ')
    if (text.includes('[dapp]')) console.log(text)
  })
  contents.setWindowOpenHandler(({ url }) => {
    if (captureDeepLink(url)) return { action: 'deny' }
    try {
      if (new URL(url).protocol === 'https:') void contents.loadURL(url)
    } catch {
      /* 忽略 */
    }
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (captureDeepLink(url)) {
      event.preventDefault()
      return
    }
    try {
      if (new URL(url).protocol !== 'https:') event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  contents.on('will-redirect', (event, url) => {
    if (captureDeepLink(url)) event.preventDefault()
  })
  contents.on('will-frame-navigate', (event: Event & { url?: string }) => {
    if (event.url && captureDeepLink(event.url)) event.preventDefault()
  })
  const inject = () => {
    if (contents.isDestroyed()) return
    injectAllFrames(contents)
  }
  contents.on('dom-ready', inject)
  contents.on('did-finish-load', inject)
  contents.on('did-frame-finish-load', inject)
  contents.on('did-navigate-in-page', inject)
  if (!contents.isLoading()) inject()
}

function injectAllFrames(contents: WebContents): void {
  const visit = (frame: Electron.WebFrameMain | undefined) => {
    if (!frame || frame.isDestroyed()) return
    void frame.executeJavaScript(DAPP_PROVIDER_INJECT).catch(() => undefined)
    void frame.executeJavaScript(DAPP_DEEP_LINK_INJECT).catch(() => undefined)
    try {
      for (const child of frame.frames) visit(child)
    } catch {
      /* 个别跨域 frame 读不到 */
    }
  }
  try {
    visit(contents.mainFrame)
  } catch {
    void contents.executeJavaScript(DAPP_PROVIDER_INJECT).catch(() => undefined)
    void contents.executeJavaScript(DAPP_DEEP_LINK_INJECT).catch(() => undefined)
  }
}
