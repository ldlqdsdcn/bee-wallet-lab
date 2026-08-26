/**
 * wallets 仓储。助记词 / passphrase 以 AES-256-GCM 密文入库。
 */
import type { MnemonicLength, WalletSummary } from '../../../../shared/types'
import { decryptSecret, encryptSecret } from '../../security/crypto'
import { decryptWithVault, encryptWithVault } from '../../security/vault'
import { getDatabase } from '../sqlite'
import { escapeLike } from '../../wallets/query'

export interface WalletRow {
  id: string
  name: string
  mnemonic_length: number
  encrypted_mnemonic: string
  encrypted_passphrase: string | null
  has_passphrase: number
  fingerprint: string | null
  is_default: number
  is_auth_wallet: number
  created_at: number
  updated_at: number
}

export interface WalletSecrets {
  mnemonic: string
  passphrase: string | null
}

function aadOf(id: string, kind: 'mnemonic' | 'passphrase'): string {
  return `wallet:${kind}:${id}`
}

export function toWalletSummary(row: WalletRow, accountCount: number): WalletSummary {
  return {
    id: row.id,
    name: row.name,
    mnemonicLength: row.mnemonic_length as MnemonicLength,
    hasPassphrase: row.has_passphrase === 1,
    isDefault: row.is_default === 1,
    isAuthWallet: row.is_auth_wallet === 1,
    createdAt: row.created_at,
    accountCount,
  }
}

export function getDefaultWalletRow(): WalletRow | null {
  const db = getDatabase()
  return (
    db.prepare<[], WalletRow>('SELECT * FROM wallets WHERE is_default = 1 LIMIT 1').get() ??
    db.prepare<[], WalletRow>('SELECT * FROM wallets ORDER BY created_at ASC LIMIT 1').get() ??
    null
  )
}

interface PickerRow {
  id: string
  name: string
  is_default: number
  cached_total: number | null
}

export function listWalletPickerPage(input: {
  name: string
  page: number
  pageSize: number
  currencyCode: string
}): { items: Array<{ id: string; name: string; isDefault: boolean; cachedTotal: string | null }>; total: number } {
  const db = getDatabase()
  const like = input.name ? `%${escapeLike(input.name)}%` : null
  const where = like ? `WHERE w.name LIKE ? ESCAPE '\\'` : ''
  const countSql = `SELECT COUNT(*) AS n FROM wallets w ${where}`
  const total = like
    ? (db.prepare<[string], { n: number }>(countSql).get(like)?.n ?? 0)
    : (db.prepare<[], { n: number }>(countSql).get()?.n ?? 0)

  const maxPage = Math.max(1, Math.ceil(total / input.pageSize) || 1)
  const page = Math.min(input.page, maxPage)
  const offset = (page - 1) * input.pageSize

  const listSql = `
    SELECT
      w.id,
      w.name,
      w.is_default,
      (
        SELECT SUM(CAST(b.currency_balance AS REAL))
        FROM accounts a
        INNER JOIN balances_cache b ON b.account_id = a.id
        WHERE a.wallet_id = w.id
          AND b.currency_balance IS NOT NULL
          AND IFNULL(b.currency_code, '') = ?
      ) AS cached_total
    FROM wallets w
    ${where}
    ORDER BY w.is_default DESC, w.created_at ASC
    LIMIT ? OFFSET ?
  `

  const rows = like
    ? db.prepare<[string, string, number, number], PickerRow>(listSql).all(input.currencyCode, like, input.pageSize, offset)
    : db.prepare<[string, number, number], PickerRow>(listSql).all(input.currencyCode, input.pageSize, offset)

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      isDefault: row.is_default === 1,
      cachedTotal: row.cached_total == null || Number.isNaN(row.cached_total) ? null : row.cached_total.toFixed(2),
    })),
  }
}

export function listWalletRows(): WalletRow[] {
  return getDatabase()
    .prepare<[], WalletRow>('SELECT * FROM wallets ORDER BY is_default DESC, created_at ASC')
    .all()
}

export function getWalletRow(id: string): WalletRow | null {
  return (
    getDatabase().prepare<[string], WalletRow>('SELECT * FROM wallets WHERE id = ?').get(id) ?? null
  )
}

export function findWalletByFingerprint(fingerprint: string): WalletRow | null {
  return (
    getDatabase()
      .prepare<[string], WalletRow>('SELECT * FROM wallets WHERE fingerprint = ?')
      .get(fingerprint) ?? null
  )
}

export function insertWallet(input: {
  id: string
  name: string
  mnemonicLength: MnemonicLength
  mnemonic: string
  passphrase?: string | null
  fingerprint: string
  isDefault: boolean
  isAuthWallet: boolean
}): WalletRow {
  const now = Date.now()
  const encryptedMnemonic = encryptWithVault(input.mnemonic, aadOf(input.id, 'mnemonic'))
  const encryptedPassphrase = input.passphrase
    ? encryptWithVault(input.passphrase, aadOf(input.id, 'passphrase'))
    : null
  getDatabase()
    .prepare(
      `INSERT INTO wallets (
         id, name, mnemonic_length, encrypted_mnemonic, encrypted_passphrase,
         has_passphrase, fingerprint, is_default, is_auth_wallet, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.name,
      input.mnemonicLength,
      encryptedMnemonic,
      encryptedPassphrase,
      input.passphrase ? 1 : 0,
      input.fingerprint,
      input.isDefault ? 1 : 0,
      input.isAuthWallet ? 1 : 0,
      now,
      now,
    )
  return getWalletRow(input.id) as WalletRow
}

export function decryptWalletSecrets(row: WalletRow): WalletSecrets {
  return {
    mnemonic: decryptWithVault(row.encrypted_mnemonic, aadOf(row.id, 'mnemonic')),
    passphrase: row.encrypted_passphrase
      ? decryptWithVault(row.encrypted_passphrase, aadOf(row.id, 'passphrase'))
      : null,
  }
}

export function updateWalletName(id: string, name: string): void {
  getDatabase()
    .prepare('UPDATE wallets SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, Date.now(), id)
}

export function clearDefaultWallets(): void {
  getDatabase().prepare('UPDATE wallets SET is_default = 0, updated_at = ?').run(Date.now())
}

export function setDefaultWallet(id: string): void {
  const db = getDatabase()
  const now = Date.now()
  const apply = db.transaction(() => {
    db.prepare('UPDATE wallets SET is_default = 0, updated_at = ?').run(now)
    db.prepare('UPDATE wallets SET is_default = 1, updated_at = ? WHERE id = ?').run(now, id)
  })
  apply()
}

export function clearAuthWallets(): void {
  getDatabase().prepare('UPDATE wallets SET is_auth_wallet = 0, updated_at = ?').run(Date.now())
}

export function setAuthWalletFlag(id: string): void {
  const db = getDatabase()
  const now = Date.now()
  const apply = db.transaction(() => {
    db.prepare('UPDATE wallets SET is_auth_wallet = 0, updated_at = ?').run(now)
    db.prepare('UPDATE wallets SET is_auth_wallet = 1, updated_at = ? WHERE id = ?').run(now, id)
  })
  apply()
}

export function deleteWallet(id: string): void {
  getDatabase().prepare('DELETE FROM wallets WHERE id = ?').run(id)
}

export function reencryptWallets(oldKek: Buffer, newKek: Buffer): void {
  const db = getDatabase()
  const rows = db.prepare<[], WalletRow>('SELECT * FROM wallets').all()
  const update = db.prepare(
    'UPDATE wallets SET encrypted_mnemonic = ?, encrypted_passphrase = ? WHERE id = ?',
  )
  for (const row of rows) {
    const mnemonic = decryptSecret(oldKek, row.encrypted_mnemonic, aadOf(row.id, 'mnemonic'))
    const passphrase = row.encrypted_passphrase
      ? decryptSecret(oldKek, row.encrypted_passphrase, aadOf(row.id, 'passphrase'))
      : null
    update.run(
      encryptSecret(newKek, mnemonic, aadOf(row.id, 'mnemonic')),
      passphrase ? encryptSecret(newKek, passphrase, aadOf(row.id, 'passphrase')) : null,
      row.id,
    )
  }
}
