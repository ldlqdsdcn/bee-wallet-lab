/**
 * 退出前确认。菜单、快捷键、关窗口走同一条路径。
 */
import { BrowserWindow, app, dialog } from 'electron'

let confirmed = false
let asking = false

export function isQuitConfirmed(): boolean {
  return confirmed
}

export async function requestQuit(): Promise<void> {
  if (confirmed) {
    app.quit()
    return
  }
  if (asking) return
  asking = true
  try {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    const options = {
      type: 'question' as const,
      buttons: ['取消', '退出'],
      defaultId: 0,
      cancelId: 0,
      title: '退出',
      message: '确定要退出 Bee Wallet Lab 吗？',
    }
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (result.response === 1) {
      confirmed = true
      app.quit()
    }
  } finally {
    asking = false
  }
}
