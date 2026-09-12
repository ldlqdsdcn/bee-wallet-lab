/**
 * 应用内浏览器：把 EIP-1193 / EIP-6963 打进页面主世界。
 * 不自动配对页面上的 wc:。抢走二维码后，网站会报「连接错误，请授权钱包访问」。
 */
import { clipboard, type Event, type WebContents } from 'electron'
import { DAPP_PROVIDER_INJECT } from '../../dapp-inject'
import { extractWalletConnectUri } from './codec'

export function isWalletConnectUrl(url: string): boolean {
  return Boolean(extractWalletConnectUri(url))
}

export async function readWalletConnectClipboard(): Promise<string> {
  try {
    return String((await clipboard.readText()) ?? '')
  } catch {
    return ''
  }
}

function denyWalletConnectUrl(raw: string): boolean {
  return Boolean(extractWalletConnectUri(raw))
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
    if (denyWalletConnectUrl(url)) return { action: 'deny' }
    try {
      if (new URL(url).protocol === 'https:') void contents.loadURL(url)
    } catch {
      /* 忽略 */
    }
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (denyWalletConnectUrl(url)) {
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
    if (denyWalletConnectUrl(url)) event.preventDefault()
  })
  contents.on('will-frame-navigate', (event: Event & { url?: string }) => {
    if (event.url && denyWalletConnectUrl(event.url)) event.preventDefault()
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
  }
}
