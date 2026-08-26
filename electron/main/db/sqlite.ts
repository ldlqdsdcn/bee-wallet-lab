/**
 * SQLite 连接与生命周期管理。
 *
 * better-sqlite3 是原生模块，用 createRequire 在运行时加载，避免被 Vite 打进 bundle。
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import type BetterSqlite3 from 'better-sqlite3'

const nodeRequire = createRequire(import.meta.url)

export type AppDatabase = BetterSqlite3.Database

let db: AppDatabase | null = null
let dbFilePath = ''

export interface OpenDatabaseOptions {
  /** 数据目录，通常是 app.getPath('userData') */
  userDataDir: string
  fileName?: string
  verbose?: boolean
}

export function openDatabase(options: OpenDatabaseOptions): AppDatabase {
  if (db) return db

  const Database = nodeRequire('better-sqlite3') as typeof BetterSqlite3
  const dir = options.userDataDir
  fs.mkdirSync(dir, { recursive: true })
  dbFilePath = path.join(dir, options.fileName ?? 'bee-wallet.db')

  const instance = new Database(dbFilePath, {
    verbose: options.verbose ? (msg?: unknown) => console.log('[sqlite]', msg) : undefined,
  })
  instance.pragma('journal_mode = WAL')
  instance.pragma('synchronous = NORMAL')
  instance.pragma('foreign_keys = ON')
  instance.pragma('busy_timeout = 5000')

  db = instance
  return db
}

export function getDatabase(): AppDatabase {
  if (!db) throw new Error('database not initialized')
  return db
}

export function getDatabaseFilePath(): string {
  return dbFilePath
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* ignore */
    }
    db.close()
    db = null
  }
}

/** 事务包装，回调内抛错自动回滚。 */
export function withTransaction<T>(fn: (database: AppDatabase) => T): T {
  const database = getDatabase()
  const run = database.transaction(fn as (arg: AppDatabase) => T)
  return run(database)
}
