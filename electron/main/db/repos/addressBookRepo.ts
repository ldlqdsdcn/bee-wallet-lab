/**
 * 地址簿仓储。
 *
 * 地址簿只保存收款方的公开信息（名称、链、网络、地址、备注），
 * 不涉及任何密钥，因此明文入库，读取也不要求保险库处于解锁状态之外的额外条件。
 */
import type {
  AddressBookEntry,
  AddressBookQuery,
  AddressBookUpsertInput,
} from '../../../../shared/types'
import { newId } from '../../security/crypto'
import { getDatabase } from '../sqlite'

interface AddressBookRow {
  id: string
  label: string
  wallet_type: string
  network_scope: string
  network_pk: string | null
  network_name: string | null
  address: string
  memo: string | null
  last_used_at: number | null
  created_at: number
  updated_at: number
}

function toEntry(row: AddressBookRow): AddressBookEntry {
  return {
    id: row.id,
    label: row.label,
    walletType: row.wallet_type as AddressBookEntry['walletType'],
    networkScope: row.network_scope as AddressBookEntry['networkScope'],
    networkPk: row.network_pk,
    networkName: row.network_name,
    address: row.address,
    memo: row.memo,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listAddressBook(query: AddressBookQuery = {}): AddressBookEntry[] {
  const where: string[] = []
  const params: unknown[] = []

  if (query.walletType) {
    where.push('wallet_type = ?')
    params.push(query.walletType)
  }
  if (query.networkScope) {
    where.push('network_scope = ?')
    params.push(query.networkScope)
  }
  // 指定网络时，同时命中"绑定该网络"与"不限网络"的条目
  if (query.networkPk) {
    where.push('(network_pk = ? OR network_pk IS NULL)')
    params.push(query.networkPk)
  }
  if (query.keyword) {
    where.push("(label LIKE ? OR address LIKE ? OR IFNULL(memo, '') LIKE ?)")
    const like = `%${query.keyword}%`
    params.push(like, like, like)
  }

  const sql = `SELECT * FROM address_book
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY IFNULL(last_used_at, 0) DESC, updated_at DESC`

  return getDatabase()
    .prepare<unknown[], AddressBookRow>(sql)
    .all(...params)
    .map(toEntry)
}

export function findAddressBookEntry(id: string): AddressBookEntry | null {
  const row = getDatabase()
    .prepare<[string], AddressBookRow>('SELECT * FROM address_book WHERE id = ?')
    .get(id)
  return row ? toEntry(row) : null
}

export function upsertAddressBookEntry(input: AddressBookUpsertInput): AddressBookEntry {
  try {
    return upsertInternal(input)
  } catch (err) {
    // 唯一索引冲突转成可读提示
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      throw new Error('该网络下已存在相同地址')
    }
    throw err
  }
}

function upsertInternal(input: AddressBookUpsertInput): AddressBookEntry {
  const db = getDatabase()
  const now = Date.now()
  const networkPk = input.networkPk ?? null
  const networkName = input.networkName ?? null
  const memo = input.memo ?? null

  if (input.id) {
    const existing = findAddressBookEntry(input.id)
    if (!existing) throw new Error('地址簿条目不存在')
    db.prepare(
      `UPDATE address_book SET
         label = ?, wallet_type = ?, network_scope = ?, network_pk = ?,
         network_name = ?, address = ?, memo = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.label,
      input.walletType,
      input.networkScope,
      networkPk,
      networkName,
      input.address,
      memo,
      now,
      input.id,
    )
    return findAddressBookEntry(input.id) as AddressBookEntry
  }

  const id = newId()
  db.prepare(
    `INSERT INTO address_book
       (id, label, wallet_type, network_scope, network_pk, network_name, address, memo, last_used_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    input.label,
    input.walletType,
    input.networkScope,
    networkPk,
    networkName,
    input.address,
    memo,
    now,
    now,
  )
  return findAddressBookEntry(id) as AddressBookEntry
}

export function removeAddressBookEntry(id: string): void {
  getDatabase().prepare('DELETE FROM address_book WHERE id = ?').run(id)
}

/** 转账使用该地址后调用，用于把常用联系人排到前面。 */
export function touchAddressBookEntry(id: string): void {
  getDatabase().prepare('UPDATE address_book SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
}
