/**
 * 应用内 DApp webview 专用。只把 beeDapp 桥到页面；ethereum 由主世界脚本挂上，
 * 避免 contextBridge 代理导致 Uniswap / Pancake 认不出钱包。
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { DAPP_DEEP_LINK_INJECT, DAPP_PROVIDER_INJECT } from './dapp-inject'
import { DAPP_PROVIDER_INFO } from './dapp-provider-info'

contextBridge.exposeInMainWorld('beeDapp', {
  request: (payload: { method: string; params?: unknown[] }) =>
    ipcRenderer.invoke('dapp:providerRequest', payload),
  pairDeepLink: (uri: string) => ipcRenderer.invoke('dapp:pairDeepLink', { uri }),
})
contextBridge.exposeInMainWorld('beeWalletProviderInfo', DAPP_PROVIDER_INFO)

void webFrame.executeJavaScript(DAPP_PROVIDER_INJECT).catch(() => undefined)
void webFrame.executeJavaScript(DAPP_DEEP_LINK_INJECT).catch(() => undefined)
void webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: DAPP_PROVIDER_INJECT }]).catch(() => undefined)
void webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: DAPP_DEEP_LINK_INJECT }]).catch(() => undefined)
