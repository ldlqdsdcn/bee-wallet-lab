/**
 * IPC 注册基础设施。
 *
 * 约定：
 * - 所有 handler 统一返回 IpcResult<T>，异常不跨进程抛出，转成 { ok:false, error }
 * - 只允许注册 shared/ipc.ts 白名单内的通道
 * - 错误码：LOCKED（未解锁）、INVALID_ARG、NOT_FOUND、BACKEND_ERROR、INTERNAL
 */
import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEventName, type IpcResult } from '../../../shared/ipc'
import { BackendError } from '../backend/http'

const channelSet = new Set<string>(IPC_CHANNELS)
const eventSet = new Set<string>(IPC_EVENTS)
const registered = new Set<string>()

export class IpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

export const invalidArg = (message: string) => new IpcError('INVALID_ARG', message)
export const notFound = (message: string) => new IpcError('NOT_FOUND', message)

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof IpcError) return { code: err.code, message: err.message }
  if (err instanceof BackendError) return { code: err.code, message: err.message }
  if (err instanceof Error) {
    // vault.requireKek() 抛出的裸 LOCKED
    if (err.message === 'LOCKED') return { code: 'LOCKED', message: '钱包已锁定，请先解锁' }
    return { code: 'INTERNAL', message: err.message }
  }
  return { code: 'INTERNAL', message: String(err) }
}

/** 注册一个 IPC handler。 */
export function handle<TArg, TResult>(
  channel: IpcChannel,
  handler: (arg: TArg) => TResult | Promise<TResult>,
): void {
  if (!channelSet.has(channel)) {
    throw new Error(`channel not in whitelist: ${channel}`)
  }
  if (registered.has(channel)) {
    throw new Error(`channel registered twice: ${channel}`)
  }
  registered.add(channel)

  ipcMain.handle(channel, async (_event, arg: TArg): Promise<IpcResult<TResult>> => {
    try {
      const data = await handler(arg)
      return { ok: true, data }
    } catch (err) {
      const error = toError(err)
      if (error.code === 'INTERNAL') console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error }
    }
  })
}

/** 向所有窗口广播事件。 */
export function broadcast(event: IpcEventName, payload?: unknown): void {
  if (!eventSet.has(event)) throw new Error(`event not in whitelist: ${event}`)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(event, payload)
  }
}

/** 尚未实现的通道占位，避免渲染进程调用时无响应挂起。 */
export function handleNotImplemented(channel: IpcChannel): void {
  handle(channel, () => {
    throw new IpcError('NOT_IMPLEMENTED', `功能尚未实现：${channel}`)
  })
}

export function listRegistered(): string[] {
  return [...registered]
}

export function disposeIpc(): void {
  for (const channel of registered) ipcMain.removeHandler(channel)
  registered.clear()
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidArg(`${field} 不能为空`)
  }
  return value
}

export function requireObject<T extends object>(value: unknown, field = '参数'): T {
  if (!value || typeof value !== 'object') throw invalidArg(`${field} 无效`)
  return value as T
}
