/**
 * 开发工具 IPC 包装。
 */
import type { DevConvertInput, DevConvertResult, DevHashInput, DevHashResult, DevJsonResult } from '@shared/types'
import { invalidArg } from '../ipc/registry'
import { convertBytes, formatJson, hashBytes } from './codec'

function wrap<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : String(err))
  }
}

export function formatDevJson(raw: string): DevJsonResult {
  return wrap(() => formatJson(raw))
}

export function convertDevBytes(input: DevConvertInput): DevConvertResult {
  return wrap(() => convertBytes(input.mode, input.value))
}

export function hashDevBytes(input: DevHashInput): DevHashResult {
  const encoding = input.encoding === 'hex' ? 'hex' : 'utf8'
  return wrap(() => hashBytes(input.value, encoding))
}
