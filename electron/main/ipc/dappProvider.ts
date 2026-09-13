import { ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { acceptWalletConnectDeepLink, handleDappProviderRequest } from '../walletconnect/service'

function fromExplorer(event: IpcMainInvokeEvent): boolean {
  return event.sender.session === session.fromPartition('persist:explorer')
}

export function registerDappProviderIpc(): void {
  ipcMain.handle('dapp:pairDeepLink', async (event: IpcMainInvokeEvent, payload: { uri?: string }) => {
    if (!fromExplorer(event)) return { ok: false, message: 'forbidden' }
    const uri = String(payload?.uri || '')
    console.log('[dapp] 深链接', uri.slice(0, 32))
    const result = await acceptWalletConnectDeepLink(uri)
    return { ok: true, ignored: Boolean(result.ignored) }
  })
  ipcMain.handle('dapp:providerRequest', async (event: IpcMainInvokeEvent, payload: { method?: string; params?: unknown[] }) => {
    if (!fromExplorer(event)) {
      return { ok: false, code: 4100, message: 'forbidden' }
    }
    const method = payload?.method
    if (!method) return { ok: false, code: -32600, message: '缺少 method' }
    let origin = ''
    try {
      origin = new URL(event.sender.getURL()).origin
    } catch {
      origin = event.sender.getURL()
    }
    console.log('[dapp]', origin, method)
    try {
      return {
        ok: true,
        data: await handleDappProviderRequest(origin, method, Array.isArray(payload.params) ? payload.params : []),
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err && typeof err.code === 'number' ? err.code : 4900
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[dapp] 失败', origin, method, message)
      return { ok: false, code, message }
    }
  })
}
