import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import type BetterSqlite3 from 'better-sqlite3'
import { LATEST_SCHEMA_VERSION, runMigrations } from '../db/migrations'
import { validateEnvironment } from './environment'

const nodeRequire = createRequire(import.meta.url)
export const DEFAULT_WORKSPACE_NAME = 'bee_wallet_workspace'
export const DB_FILE = 'bee-wallet.db'
export const MANIFEST_FILE = 'workspace.json'
export const ENV_FILE = 'environment.json'
const FILES = [MANIFEST_FILE, DB_FILE, ENV_FILE, 'walletconnect.json'] as const
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

export interface WorkspaceManifest {
  format: 'bee-wallet-workspace'
  version: 1
  name: string
  createdAt: string
}

function database(file: string, readonly = true): BetterSqlite3.Database {
  const Database = nodeRequire('better-sqlite3') as typeof BetterSqlite3
  return new Database(file, { readonly, fileMustExist: readonly })
}

export function writeJson(file: string, value: unknown): void {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

function readManifest(value: unknown): WorkspaceManifest {
  const manifest = value as Partial<WorkspaceManifest> | null
  if (!manifest || manifest.format !== 'bee-wallet-workspace' || manifest.version !== 1 ||
      typeof manifest.name !== 'string' || !manifest.name.trim() || typeof manifest.createdAt !== 'string') {
    throw new Error('无效或不支持的工作区格式 / Invalid or unsupported workspace format')
  }
  return manifest as WorkspaceManifest
}

function readFile(dir: string, name: string): Buffer {
  const file = path.join(dir, name)
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error(`Invalid workspace file: ${name}`)
  return fs.readFileSync(file)
}

export function validateWorkspace(dir: string): WorkspaceManifest {
  const manifest = readManifest(JSON.parse(readFile(dir, MANIFEST_FILE).toString()))
  validateEnvironment(JSON.parse(readFile(dir, ENV_FILE).toString()))
  // Reject links rather than opening a database outside the selected workspace.
  const stat = fs.lstatSync(path.join(dir, DB_FILE))
  if (!stat.isFile()) throw new Error('Invalid workspace database')
  if (fs.existsSync(path.join(dir, 'walletconnect.json'))) {
    const storage = JSON.parse(readFile(dir, 'walletconnect.json').toString())
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) throw new Error('Invalid WalletConnect storage')
  }
  const db = database(path.join(dir, DB_FILE))
  try {
    const version = Number(db.pragma('user_version', { simple: true }))
    if (version < 1 || version > LATEST_SCHEMA_VERSION) throw new Error('数据库版本不受支持，请升级应用 / Unsupported database version')
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('工作区数据库损坏 / Corrupt database')
    for (const table of ['app_meta', 'settings', 'wallets', 'accounts']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) {
        throw new Error(`Missing workspace table: ${table}`)
      }
    }
  } finally {
    db.close()
  }
  return manifest
}

/** SQLite creates a consistent snapshot including committed WAL data. Never copy a live .db file. */
export function snapshotDatabase(source: string, destination: string): void {
  const db = database(source)
  try {
    db.prepare('VACUUM INTO ?').run(destination)
    fs.chmodSync(destination, 0o600)
  } finally {
    db.close()
  }
}

/** Stage beside the destination, validate everything, then publish without touching existing data. */
function publishWorkspace(destination: string, populate: (stage: string) => void): string {
  const target = path.resolve(destination)
  if (fs.existsSync(target)) throw new Error('请选择尚不存在的新文件夹 / Choose a new folder that does not exist')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.bee-workspace-'))
  try {
    populate(stage)
    validateWorkspace(stage)
    // Recheck after validation; never replace an existing workspace.
    if (fs.existsSync(target)) throw new Error('工作区已存在 / Workspace already exists')
    fs.renameSync(stage, target)
    return target
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

export function createWorkspace(destination: string, environment: Record<string, string>, legacyDir?: string): string {
  return publishWorkspace(destination, (stage) => {
    writeJson(path.join(stage, MANIFEST_FILE), {
      format: 'bee-wallet-workspace', version: 1, name: path.basename(destination), createdAt: new Date().toISOString(),
    } satisfies WorkspaceManifest)
    writeJson(path.join(stage, ENV_FILE), validateEnvironment(environment))
    const legacyDb = legacyDir && path.join(legacyDir, DB_FILE)
    if (legacyDb && fs.existsSync(legacyDb)) {
      snapshotDatabase(legacyDb, path.join(stage, DB_FILE))
    } else {
      const db = database(path.join(stage, DB_FILE), false)
      try { runMigrations(db) } finally { db.close() }
      fs.chmodSync(path.join(stage, DB_FILE), 0o600)
    }
    if (legacyDir && fs.existsSync(path.join(legacyDir, 'walletconnect.json'))) {
      fs.writeFileSync(path.join(stage, 'walletconnect.json'), readFile(legacyDir, 'walletconnect.json'), { mode: 0o600 })
    }
  })
}

interface ArchiveEntry { name: string; data: string; sha256: string }
function checksum(data: Buffer): string { return createHash('sha256').update(data).digest('hex') }

export function exportWorkspace(source: string, destination: string): void {
  validateWorkspace(source)
  const output = path.resolve(destination)
  // A save dialog must never allow an export to overwrite live workspace data.
  const relative = path.relative(fs.realpathSync(source), path.join(fs.realpathSync(path.dirname(output)), path.basename(output)))
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) {
    throw new Error('备份请保存到当前工作区以外 / Save the backup outside the active workspace')
  }
  const stage = fs.mkdtempSync(path.join(source, '.export-'))
  const temp = `${output}.${randomUUID()}.tmp`
  try {
    snapshotDatabase(path.join(source, DB_FILE), path.join(stage, DB_FILE))
    const entries: ArchiveEntry[] = FILES.filter((name) => fs.existsSync(path.join(source, name))).map((name) => {
      const data = readFile(name === DB_FILE ? stage : source, name)
      return { name, data: data.toString('base64'), sha256: checksum(data) }
    })
    const payload = Buffer.from(JSON.stringify({ format: 'bee-wallet-workspace-archive', version: 1, entries }))
    if (payload.length > MAX_ARCHIVE_BYTES) throw new Error('Workspace archive exceeds 512 MiB')
    fs.writeFileSync(temp, gzipSync(payload), { mode: 0o600, flag: 'wx' })
    fs.renameSync(temp, output)
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
    fs.rmSync(temp, { force: true })
  }
}

export function importWorkspace(archiveFile: string, destination: string): string {
  if (fs.statSync(archiveFile).size > MAX_ARCHIVE_BYTES) throw new Error('Workspace archive exceeds 512 MiB')
  const archive = JSON.parse(gunzipSync(fs.readFileSync(archiveFile), { maxOutputLength: MAX_ARCHIVE_BYTES }).toString())
  if (archive?.format !== 'bee-wallet-workspace-archive' || archive.version !== 1 || !Array.isArray(archive.entries) ||
      archive.entries.length < 3 || archive.entries.length > FILES.length) throw new Error('Invalid workspace archive')
  const entries: ArchiveEntry[] = archive.entries
  const seen = new Set<string>()
  const decoded = entries.map((entry) => {
    if (!entry || !(FILES as readonly string[]).includes(entry.name) || seen.has(entry.name) ||
        typeof entry.data !== 'string' || typeof entry.sha256 !== 'string') throw new Error('Invalid archive entry')
    seen.add(entry.name)
    const data = Buffer.from(entry.data, 'base64')
    if (checksum(data) !== entry.sha256) throw new Error('备份校验失败 / Archive checksum mismatch')
    return { name: entry.name, data }
  })
  for (const name of [MANIFEST_FILE, DB_FILE, ENV_FILE]) {
    if (!seen.has(name)) throw new Error(`Missing archive entry: ${name}`)
  }
  return publishWorkspace(destination, (stage) => {
    for (const entry of decoded) fs.writeFileSync(path.join(stage, entry.name), entry.data, { flag: 'wx', mode: 0o600 })
  })
}
