/**
 * WalletConnect 会话存在 userData，主进程没有 localStorage。
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
      const data = read()
      data[key] = value
      write(data)
    },
    async removeItem(key: string) {
      const data = read()
      delete data[key]
      write(data)
    },
  }
}
