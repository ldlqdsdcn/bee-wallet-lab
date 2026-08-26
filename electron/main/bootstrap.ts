/**
 * 主进程启动引导：数据库 -> 迁移 -> 保险库 -> IPC。
 */
import { app } from 'electron'
import { runMigrations } from './db/migrations'
import { closeDatabase, getDatabaseFilePath, openDatabase } from './db/sqlite'

import { initVault, disposeVault } from './security/vault'
import { registerAllIpc } from './ipc'

let started = false

export function bootstrap(): void {
  if (started) return

  const db = openDatabase({ userDataDir: app.getPath('userData') })
  const { from, to } = runMigrations(db)
  if (from !== to) {
    console.log(`[db] migrated schema ${from} -> ${to} at ${getDatabaseFilePath()}`)
  }

  initVault()
  registerAllIpc()
  started = true
}

export function shutdown(): void {
  disposeVault()
  closeDatabase()
  started = false
}
