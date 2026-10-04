import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkspace, DB_FILE, ENV_FILE, exportWorkspace, importWorkspace, validateWorkspace,
} from '../electron/main/workspace/files'
import { LATEST_SCHEMA_VERSION } from '../electron/main/db/migrations'
import { createKdfDescriptor, createVerifier, deriveKek, encryptSecret, decryptSecret, verifyKek } from '../electron/main/security/crypto'
import type BetterSqlite3 from 'better-sqlite3'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3
let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-workspace-test-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })
const dir = (name: string) => path.join(root, name)
function create(name = 'source') { return createWorkspace(dir(name), { VITE_INFURA_API_KEY: 'portable-test-key' }) }
function alterArchive(file: string, change: (data: { entries: { name: string; data: string; sha256: string }[] }) => void) {
  const archive = JSON.parse(gunzipSync(fs.readFileSync(file)).toString())
  change(archive)
  fs.writeFileSync(file, gzipSync(JSON.stringify(archive)))
}

describe('workspace storage and migration', () => {
  it('creates an independent empty vault and never overwrites an existing folder', () => {
    const source = create()
    const db = new Database(path.join(source, DB_FILE))
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
    expect(db.prepare('SELECT COUNT(*) AS n FROM wallets').get()).toEqual({ n: 0 })
    db.close()
    expect(() => create()).toThrow('新文件夹')
    expect(validateWorkspace(source).name).toBe('source')
    expect(fs.statSync(path.join(source, ENV_FILE)).mode & 0o777).toBe(0o600)
  })

  it('migrates committed WAL data and WalletConnect without changing legacy files', () => {
    const source = create('legacy')
    const db = new Database(path.join(source, DB_FILE))
    try {
      db.pragma('journal_mode = WAL')
      db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('app', JSON.stringify({ language: 'en', proxyEnabled: true }), 1)
      fs.writeFileSync(path.join(source, 'walletconnect.json'), JSON.stringify({ session: 'test' }))
      const before = fs.readFileSync(path.join(source, DB_FILE))
      const migrated = createWorkspace(dir('bee_wallet_workspace'), {}, source)
      const copy = new Database(path.join(migrated, DB_FILE))
      expect(copy.prepare('SELECT value FROM settings').get()).toEqual({ value: JSON.stringify({ language: 'en', proxyEnabled: true }) })
      copy.close()
      expect(fs.readFileSync(path.join(source, DB_FILE))).toEqual(before)
      expect(JSON.parse(fs.readFileSync(path.join(migrated, 'walletconnect.json'), 'utf8'))).toEqual({ session: 'test' })
    } finally { db.close() }
  })

  it('initializes once and preserves selection until restart', async () => {
    vi.resetModules()
    const state = await import('../electron/main/workspace/state')
    const first = state.initializeWorkspace(dir('userData'))
    expect(first).toBe(dir('userData/bee_wallet_workspace'))
    const second = create('other')
    state.selectWorkspace(second)
    expect(state.getWorkspaceDirectory()).toBe(first)
    expect(state.initializeWorkspace(dir('userData'))).toBe(second)
    fs.rmSync(second, { recursive: true })
    expect(() => state.initializeWorkspace(dir('userData'))).toThrow()
    // Never silently switch to an empty vault when a selected drive is unavailable.
    expect(JSON.parse(fs.readFileSync(dir('userData/workspace-state.json'), 'utf8')).activeDirectory).toBe(second)
  })

  it('rejects future or damaged databases', () => {
    const source = create()
    const db = new Database(path.join(source, DB_FILE))
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => validateWorkspace(source)).toThrow('版本')
    fs.writeFileSync(path.join(source, DB_FILE), 'broken')
    expect(() => validateWorkspace(source)).toThrow()
  })

  it('cleans staging files on migration failure', () => {
    fs.mkdirSync(dir('legacy'))
    fs.writeFileSync(dir('legacy/bee-wallet.db'), 'bad database')
    expect(() => createWorkspace(dir('migrated'), {}, dir('legacy'))).toThrow()
    expect(fs.readdirSync(root)).toEqual(['legacy'])
  })
})

describe('portable workspace backup', () => {
  it('round-trips encrypted wallets, settings, runtime keys and sessions with the same master password', () => {
    const source = create()
    const db = new Database(path.join(source, DB_FILE))
    const kdf = createKdfDescriptor()
    const kek = deriveKek('Workspace-test-password!2026', kdf)
    const ciphertext = encryptSecret(kek, 'test mnemonic data', 'wallet-id')
    try {
      db.pragma('journal_mode = WAL')
      db.prepare('INSERT INTO app_meta VALUES (?, ?, ?)').run('vault.kdf', JSON.stringify(kdf), 1)
      db.prepare('INSERT INTO app_meta VALUES (?, ?, ?)').run('vault.verifier', createVerifier(kek), 1)
      db.prepare(`INSERT INTO wallets (id, name, mnemonic_length, encrypted_mnemonic, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run('wallet-id', 'portable wallet', 12, ciphertext, 1, 1)
      db.prepare('INSERT INTO settings VALUES (?, ?, ?)').run('app', JSON.stringify({ baseUrl: 'https://test.example', defaultWalletId: 'wallet-id' }), 1)
      fs.writeFileSync(path.join(source, 'walletconnect.json'), JSON.stringify({ key: 'session-key' }))
      const archive = dir('backup.beeworkspace')
      exportWorkspace(source, archive)
      const imported = importWorkspace(archive, dir('imported'))
      const copy = new Database(path.join(imported, DB_FILE))
      try {
        const row = copy.prepare('SELECT encrypted_mnemonic FROM wallets').get() as { encrypted_mnemonic: string }
        expect(row.encrypted_mnemonic).toBe(ciphertext)
        expect(decryptSecret(kek, row.encrypted_mnemonic, 'wallet-id')).toBe('test mnemonic data')
        const verifier = copy.prepare("SELECT value FROM app_meta WHERE key = 'vault.verifier'").get() as { value: string }
        expect(verifyKek(kek, verifier.value)).toBe(true)
        expect(copy.prepare('SELECT value FROM settings').get()).toEqual(db.prepare('SELECT value FROM settings').get())
        expect(fs.readFileSync(path.join(imported, ENV_FILE))).toEqual(fs.readFileSync(path.join(source, ENV_FILE)))
        expect(JSON.parse(fs.readFileSync(path.join(imported, 'walletconnect.json'), 'utf8'))).toEqual({ key: 'session-key' })
      } finally { copy.close() }
      expect(fs.readdirSync(source).some((f) => f.startsWith('.export-'))).toBe(false)
    } finally { db.close(); kek.fill(0) }
  })

  it.each(['../outside', '/tmp/outside', DB_FILE])('rejects unsafe or duplicate archive entry %s', (name) => {
    const source = create()
    const archive = dir('backup.beeworkspace')
    exportWorkspace(source, archive)
    alterArchive(archive, (data) => { data.entries.push({ ...data.entries[1], name }) })
    expect(() => importWorkspace(archive, dir('imported'))).toThrow('Invalid archive entry')
    expect(fs.existsSync(dir('imported'))).toBe(false)
  })

  it('rejects tampering and incomplete backups without publishing a directory', () => {
    const source = create()
    const archive = dir('backup.beeworkspace')
    exportWorkspace(source, archive)
    alterArchive(archive, (data) => { data.entries[1].data = Buffer.from('tampered').toString('base64') })
    expect(() => importWorkspace(archive, dir('imported'))).toThrow('checksum')
    exportWorkspace(source, archive)
    alterArchive(archive, (data) => { data.entries = data.entries.filter((entry) => entry.name !== DB_FILE) })
    expect(() => importWorkspace(archive, dir('imported'))).toThrow('Invalid workspace archive')
    expect(fs.existsSync(dir('imported'))).toBe(false)
  })

  it('refuses an export over active data and refuses import over existing data', () => {
    const source = create()
    const before = fs.readFileSync(path.join(source, DB_FILE))
    expect(() => exportWorkspace(source, path.join(source, DB_FILE))).toThrow('当前工作区以外')
    expect(fs.readFileSync(path.join(source, DB_FILE))).toEqual(before)
    const archive = dir('backup.beeworkspace')
    exportWorkspace(source, archive)
    expect(() => importWorkspace(archive, source)).toThrow('新文件夹')
    expect(validateWorkspace(source)).toBeTruthy()
  })

  it('rejects symlinked files in an opened workspace', () => {
    const source = create()
    fs.renameSync(path.join(source, ENV_FILE), dir('external.json'))
    fs.symlinkSync(dir('external.json'), path.join(source, ENV_FILE))
    expect(() => validateWorkspace(source)).toThrow('Invalid workspace file')
  })
})

describe('workspace runtime configuration', () => {
  it('never inherits local API keys for missing or empty workspace values', async () => {
    vi.resetModules()
    const env = await import('../electron/main/workspace/environment')
    vi.stubEnv('VITE_INFURA_API_KEY', 'computer-a-key')
    env.setWorkspaceEnvironment({ VITE_INFURA_API_KEY: 'workspace-b-key' })
    expect(env.readEnvironment('VITE_INFURA_API_KEY')).toBe('workspace-b-key')
    env.setWorkspaceEnvironment({})
    expect(env.readEnvironment('VITE_INFURA_API_KEY')).toBe('')
    expect(() => env.validateEnvironment({ NODE_OPTIONS: '--require unwanted.js' })).toThrow()
    vi.unstubAllEnvs()
  })

  it('loads the catalog default from the selected workspace after modules have been imported', async () => {
    vi.resetModules()
    const { openDatabase, closeDatabase } = await import('../electron/main/db/sqlite')
    const { loadSettings } = await import('../electron/main/db/repos/metaRepo')
    const env = await import('../electron/main/workspace/environment')
    const source = create()
    openDatabase({ userDataDir: source })
    try {
      env.setWorkspaceEnvironment({ VITE_CATALOG_BASE_URL: 'https://workspace-b.example/' })
      expect(loadSettings().baseUrl).toBe('https://workspace-b.example')
      env.setWorkspaceEnvironment({})
      expect(loadSettings().baseUrl).toBe('')
    } finally { closeDatabase() }
  })

})
