/**
 * WalletConnect 会话存在 userData，主进程没有 localStorage。
 * 写入必须串行，否则并行 setItem 会互相覆盖，密钥或历史丢一条。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface FileKeyValueStorage {
  getKeys(): Promise<string[]>
  getEntries<T = unknown>(): Promise<[string, T][]>
  getItem<T = unknown>(key: string): Promise<T | undefined>
  setItem<T = unknown>(key: string, value: T): Promise<void>
  removeItem(key: string): Promise<void>
}

export function createFileKeyValueStorage(filePath: string): FileKeyValueStorage {
  const read = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const write = (data: Record<string, unknown>) => {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(data))
  }

  let queue = Promise.resolve()
  const mutate = (fn: (data: Record<string, unknown>) => void) => {
    queue = queue.then(() => {
      const data = read()
      fn(data)
      write(data)
    })
    return queue
  }

  return {
    async getKeys() {
      return Object.keys(read())
    },
    async getEntries<T>() {
      return Object.entries(read()) as [string, T][]
    },
    async getItem<T>(key: string) {
      return read()[key] as T | undefined
    },
    async setItem<T>(key: string, value: T) {
      await mutate((data) => {
        data[key] = value
      })
    },
    async removeItem(key: string) {
      await mutate((data) => {
        delete data[key]
      })
    },
  }
}
