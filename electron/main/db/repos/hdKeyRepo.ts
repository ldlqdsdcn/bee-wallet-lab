/**
 * HD 分层派生结果。地址和公钥明文；私钥用保险库 KEK 加密。
 */
import type { HdKeyRecord, WalletType } from '../../../../shared/types'
import { decryptSecret, encryptSecret, newId } from '../../security/crypto'
import { decryptWithVault, encryptWithVault } from '../../security/vault'
import { getDatabase } from '../sqlite'

export interface HdKeyRow {
  id: string
  wallet_id: string
  wallet_type: string
  account_index: number
  address_index: number
  root_path: string
  address: string
  public_key: string
  encrypted_private_key: string
  created_at: number
  updated_at: number
}

function aadOf(id: string): string {
  return `hd:pk:${id}`
}

export function toHdKeyRecord(row: HdKeyRow): HdKeyRecord {
  return {
    id: row.id,
    walletId: row.wallet_id,
    walletType: row.wallet_type as WalletType,
    accountIndex: row.account_index,
    addressIndex: row.address_index,
    path: row.root_path,
    address: row.address,
    publicKey: row.public_key,
    createdAt: row.created_at,
  }
}

export function listHdKeyRows(walletId: string, accountIndex?: number): HdKeyRow[] {
  const db = getDatabase()
  if (accountIndex == null) {
    return db
      .prepare<[string], HdKeyRow>(
        `SELECT * FROM hd_keys WHERE wallet_id = ?
         ORDER BY wallet_type, account_index, address_index`,
      )
      .all(walletId)
  }
  return db
    .prepare<[string, number], HdKeyRow>(
      `SELECT * FROM hd_keys WHERE wallet_id = ? AND account_index = ?
       ORDER BY wallet_type, address_index`,
    )
    .all(walletId, accountIndex)
}

export function listHdKeys(walletId: string, accountIndex?: number): HdKeyRecord[] {
  return listHdKeyRows(walletId, accountIndex).map(toHdKeyRecord)
}

export function listHdKeysInRange(
  walletId: string,
  walletType: WalletType,
  accountIndex: number,
  fromIndex: number,
  toIndex: number,
): HdKeyRecord[] {
  return getDatabase()
    .prepare<[string, string, number, number, number], HdKeyRow>(
      `SELECT * FROM hd_keys
       WHERE wallet_id = ? AND wallet_type = ? AND account_index = ?
         AND address_index BETWEEN ? AND ?
       ORDER BY address_index`,
    )
    .all(walletId, walletType, accountIndex, fromIndex, toIndex)
    .map(toHdKeyRecord)
}

export function listExistingHdIndexes(
  walletId: string,
  walletType: WalletType,
  accountIndex: number,
  fromIndex: number,
  toIndex: number,
): number[] {
  return getDatabase()
    .prepare<[string, string, number, number, number], { address_index: number }>(
      `SELECT address_index FROM hd_keys
       WHERE wallet_id = ? AND wallet_type = ? AND account_index = ?
         AND address_index BETWEEN ? AND ?
       ORDER BY address_index`,
    )
    .all(walletId, walletType, accountIndex, fromIndex, toIndex)
    .map((row) => row.address_index)
}

export function countHdKeys(walletId: string): number {
  const row = getDatabase()
    .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM hd_keys WHERE wallet_id = ?')
    .get(walletId)
  return row?.n ?? 0
}

export function getHdKeyRow(id: string): HdKeyRow | null {
  return getDatabase().prepare<[string], HdKeyRow>('SELECT * FROM hd_keys WHERE id = ?').get(id) ?? null
}

export function decryptHdPrivateKey(row: HdKeyRow): string {
  return decryptWithVault(row.encrypted_private_key, aadOf(row.id))
}

export function upsertHdKeys(
  walletId: string,
  walletType: WalletType,
  accountIndex: number,
  rows: Array<{ index: number; path: string; address: string; publicKey: string; privateKey: string }>,
): number {
  const db = getDatabase()
  const existing = new Map<number, string>()
  for (const row of listHdKeyRows(walletId, accountIndex).filter((item) => item.wallet_type === walletType)) {
    existing.set(row.address_index, row.id)
  }

  const insert = db.prepare(
    `INSERT INTO hd_keys (
       id, wallet_id, wallet_type, account_index, address_index, root_path,
       address, public_key, encrypted_private_key, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(wallet_id, wallet_type, account_index, address_index) DO UPDATE SET
       root_path = excluded.root_path,
       address = excluded.address,
       public_key = excluded.public_key,
       encrypted_private_key = excluded.encrypted_private_key,
       updated_at = excluded.updated_at`,
  )

  const now = Date.now()
  const apply = db.transaction(() => {
    for (const row of rows) {
      const id = existing.get(row.index) ?? newId()
      insert.run(
        id,
        walletId,
        walletType,
        accountIndex,
        row.index,
        row.path,
        row.address,
        row.publicKey,
        encryptWithVault(row.privateKey, aadOf(id)),
        now,
        now,
      )
    }
    return rows.length
  })
  return apply()
}

export function deleteHdKeys(walletId: string, accountIndex?: number): number {
  const db = getDatabase()
  if (accountIndex == null) {
    const result = db.prepare('DELETE FROM hd_keys WHERE wallet_id = ?').run(walletId)
    return result.changes
  }
  const result = db
    .prepare('DELETE FROM hd_keys WHERE wallet_id = ? AND account_index = ?')
    .run(walletId, accountIndex)
  return result.changes
}

export function reencryptHdKeys(oldKek: Buffer, newKek: Buffer): void {
  const db = getDatabase()
  const rows = db.prepare<[], HdKeyRow>('SELECT * FROM hd_keys').all()
  const update = db.prepare('UPDATE hd_keys SET encrypted_private_key = ? WHERE id = ?')
  const apply = db.transaction(() => {
    for (const row of rows) {
      const hex = decryptSecret(oldKek, row.encrypted_private_key, aadOf(row.id))
      update.run(encryptSecret(newKek, hex, aadOf(row.id)), row.id)
    }
  })
  apply()
}
