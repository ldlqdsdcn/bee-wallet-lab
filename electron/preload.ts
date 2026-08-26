import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEventName, type IpcResult } from '../shared/ipc'

/**
 * 预加载脚本：渲染进程与主进程之间唯一的通道。
 *
 * 安全约束：
 * - 只暴露 shared/ipc.ts 白名单内的通道，不暴露原始 ipcRenderer
 * - 不提供任意 send，避免渲染进程触达未受控的主进程逻辑
 */
const channels = new Set<string>(IPC_CHANNELS)
const events = new Set<string>(IPC_EVENTS)

async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<IpcResult<T>> {
  if (!channels.has(channel)) {
    return { ok: false, error: { code: 'FORBIDDEN_CHANNEL', message: `非法通道：${channel}` } }
  }
  return (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>
}

function subscribe(event: IpcEventName, listener: (payload: unknown) => void): () => void {
  if (!events.has(event)) throw new Error(`非法事件：${event}`)
  const wrapped = (_e: unknown, payload: unknown) => listener(payload)
  ipcRenderer.on(event, wrapped)
  return () => ipcRenderer.off(event, wrapped)
}

const api = {
  invoke,
  subscribe,
  platform: process.platform,
} as const

export type BeeWalletBridge = typeof api

contextBridge.exposeInMainWorld('beeWallet', api)
