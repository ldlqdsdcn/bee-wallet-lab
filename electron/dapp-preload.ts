/**
 * 应用内 DApp webview 专用。只把 beeDapp 桥到页面；ethereum 由主世界脚本挂上，
 * 避免 contextBridge 代理导致 Uniswap / Pancake 认不出钱包。
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { DAPP_PROVIDER_INJECT } from './dapp-inject'

contextBridge.exposeInMainWorld('beeDapp', {
  request: (payload: { method: string; params?: unknown[] }) =>
    ipcRenderer.invoke('dapp:providerRequest', payload),
})
contextBridge.exposeInMainWorld('beeWalletProviderInfo', {
  uuid: 'a6c8d2e1-7b54-4f0a-9c31-2e8c4b0f1a77',
  name: 'Bee Wallet Lab',
  icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%23f5c518"/%3E%3Ctext x="16" y="21" text-anchor="middle" font-size="14" font-family="sans-serif" fill="%23111111"%3EB%3C/text%3E%3C/svg%3E',
  rdns: 'lab.bee-wallet',
})

void webFrame.executeJavaScript(DAPP_PROVIDER_INJECT).catch(() => undefined)
void webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: DAPP_PROVIDER_INJECT }]).catch(() => undefined)
