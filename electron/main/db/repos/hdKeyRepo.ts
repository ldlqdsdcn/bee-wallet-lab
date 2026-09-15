/**
 * HD 分层派生结果。地址和公钥明文；私钥用保险库 KEK 加密。
 */
import type { BitcoinAddressType, HdKeyQuery, HdKeyRecord, NetworkScope, WalletType } from '../../../../shared/types'
import { decryptSecret, encryptSecret, newId } from '../../security/crypto'
import { decryptWithVault, encryptWithVault } from '../../security/vault'
import { getDatabase } from '../sqlite'

export interface HdKeyRow {
  id: string
  wallet_id: string
  wallet_type: string
  network_scope: string
  address_type: string | null
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
    networkScope: (row.network_scope || 'mainnet') as NetworkScope,
    addressType: (row.address_type as BitcoinAddressType | null) ?? null,
    accountIndex: row.account_index,
    addressIndex: row.address_index,
    path: row.root_path,
    address: row.address,
    publicKey: row.public_key,
    createdAt: row.created_at,
  }
}

function scopedWhere(query: HdKeyQuery): { sql: string; args: unknown[] } {
  const clauses = ['wallet_id = ?']
  const args: unknown[] = [query.walletId]
  if (query.walletType) {
    clauses.push('wallet_type = ?')
    args.push(query.walletType)
  }
  if (query.networkScope) {
    clauses.push('network_scope = ?')
    args.push(query.networkScope)
  }
  if (query.addressType !== undefined) {
    if (query.addressType) {
      clauses.push('address_type = ?')
      args.push(query.addressType)
    } else {
      clauses.push('address_type IS NULL')
    }
  }
  if (query.accountIndex != null) {
    clauses.push('account_index = ?')
    args.push(query.accountIndex)
  }
  if (query.fromIndex != null && Number.isInteger(query.fromIndex)) {
    clauses.push('address_index >= ?')
    args.push(query.fromIndex)
  }
  if (query.toIndex != null && Number.isInteger(query.toIndex)) {
    clauses.push('address_index <= ?')
    args.push(query.toIndex)
  }
  return { sql: clauses.join(' AND '), args }
}

export function listHdKeyRows(query: HdKeyQuery): HdKeyRow[] {
  const { sql, args } = scopedWhere(query)
  return getDatabase()
    .prepare<unknown[], HdKeyRow>(
      `SELECT * FROM hd_keys WHERE ${sql}
       ORDER BY wallet_type, network_scope, account_index, address_index`,
    )
    .all(...args)
}

export function listHdKeys(query: HdKeyQuery): HdKeyRecord[] {
  return listHdKeyRows(query).map(toHdKeyRecord)
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
  networkScope: NetworkScope,
  addressType?: BitcoinAddressType | null,
): number[] {
  return getDatabase()
    .prepare<unknown[], { address_index: number }>(
      `SELECT address_index FROM hd_keys
       WHERE wallet_id = ? AND wallet_type = ? AND network_scope = ?
         AND IFNULL(address_type, '') = ? AND account_index = ?
         AND address_index BETWEEN ? AND ?
       ORDER BY address_index`,
    )
    .all(walletId, walletType, networkScope, addressType ?? '', accountIndex, fromIndex, toIndex)
    .map((row) => row.address_index)
}

export function countHdKeys(walletId: string, walletType?: WalletType): number {
  if (!walletType) {
    const row = getDatabase()
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM hd_keys WHERE wallet_id = ?')
      .get(walletId)
    return row?.n ?? 0
  }
  const row = getDatabase()
    .prepare<[string, string], { n: number }>(
      'SELECT COUNT(*) AS n FROM hd_keys WHERE wallet_id = ? AND wallet_type = ?',
    )
    .get(walletId, walletType)
  return row?.n ?? 0
}

export function getHdKeyRow(id: string): HdKeyRow | null {
  return getDatabase().prepare<[string], HdKeyRow>('SELECT * FROM hd_keys WHERE id = ?').get(id) ?? null
}

export function findHdKeyByAddress(walletId: string, address: string): HdKeyRow | null {
  const needle = address.trim().toLowerCase()
  if (!needle) return null
  return (
    getDatabase()
      .prepare<[string, string], HdKeyRow>(
        'SELECT * FROM hd_keys WHERE wallet_id = ? AND lower(address) = ? LIMIT 1',
      )
      .get(walletId, needle) ?? null
  )
}

export function decryptHdPrivateKey(row: HdKeyRow): string {
  return decryptWithVault(row.encrypted_private_key, aadOf(row.id))
}

export function upsertHdKeys(
  walletId: string,
  walletType: WalletType,
  accountIndex: number,
  networkScope: NetworkScope,
  addressType: BitcoinAddressType | null,
  rows: Array<{ index: number; path: string; address: string; publicKey: string; privateKey: string }>,
): number {
  const db = getDatabase()
  const existing = new Map<number, string>()
  for (const row of listHdKeyRows({ walletId, walletType, accountIndex, networkScope, addressType })) {
    existing.set(row.address_index, row.id)
  }

  const insert = db.prepare(
    `INSERT INTO hd_keys (
       id, wallet_id, wallet_type, network_scope, address_type,
       account_index, address_index, root_path,
       address, public_key, encrypted_private_key, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const update = db.prepare(
    `UPDATE hd_keys SET
       root_path = ?, address = ?, public_key = ?, encrypted_private_key = ?, updated_at = ?
     WHERE id = ?`,
  )

  const now = Date.now()
  const apply = db.transaction(() => {
    for (const row of rows) {
      const id = existing.get(row.index) ?? newId()
      const secret = encryptWithVault(row.privateKey, aadOf(id))
      if (existing.has(row.index)) {
        update.run(row.path, row.address, row.publicKey, secret, now, id)
      } else {
        insert.run(
          id,
          walletId,
          walletType,
          networkScope,
          addressType,
          accountIndex,
          row.index,
          row.path,
          row.address,
          row.publicKey,
          secret,
          now,
          now,
        )
      }
    }
    return rows.length
  })
  return apply()
}

export function deleteHdKeys(query: HdKeyQuery): number {
  const { sql, args } = scopedWhere(query)
  const result = getDatabase().prepare(`DELETE FROM hd_keys WHERE ${sql}`).run(...args)
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
