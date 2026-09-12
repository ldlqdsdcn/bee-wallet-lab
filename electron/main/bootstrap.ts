/**
 * 主进程启动引导：数据库 -> 迁移 -> 保险库 -> IPC。
 */
import { app } from 'electron'
import { runMigrations } from './db/migrations'
import { closeDatabase, getDatabaseFilePath, openDatabase } from './db/sqlite'

import { initVault, disposeVault } from './security/vault'
import { registerAllIpc } from './ipc'
import { applyActiveProxy } from './net/proxy'
import { migrateLegacyProxy } from './net/proxies'
import { ensureDefaultFiat } from './db/repos/metaRepo'
import { disposeTransactionWatch } from './history/watch'

let started = false

export async function bootstrap(): Promise<void> {
  if (started) return

  const db = openDatabase({ userDataDir: app.getPath('userData') })
  const { from, to } = runMigrations(db)
  if (from !== to) {
    console.log(`[db] migrated schema ${from} -> ${to} at ${getDatabaseFilePath()}`)
  }

  initVault()
  migrateLegacyProxy()
  ensureDefaultFiat()
  try {
    await applyActiveProxy()
  } catch (err) {
    console.warn('[proxy] 应用代理失败', err instanceof Error ? err.message : err)
  }
  registerAllIpc()
  started = true
}

export function shutdown(): void {
  disposeTransactionWatch()
  disposeVault()
  closeDatabase()
  started = false
}
