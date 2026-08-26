/**
 * accounts 仓储。HD 账户不存私钥；导入账户的私钥以 AES-256-GCM 密文入库。
 */
import type {
  AccountRecord,
  AccountSource,
  BitcoinAddressType,
  NetworkScope,
  WalletType,
} from '../../../../shared/types'
import { decryptSecret, encryptSecret } from '../../security/crypto'
import { decryptWithVault, encryptWithVault } from '../../security/vault'
import { getDatabase } from '../sqlite'
import { loadSettings } from './metaRepo'

export interface AccountRow {
  id: string
  wallet_id: string | null
  wallet_type: string
  network_scope: string
  address_type: string | null
  root_path: string | null
  account_index: number
  address_index: number
  address: string
  public_key: string
  label: string | null
  source: string
  encrypted_private_key: string | null
  created_at: number
  updated_at: number
}

function aadOf(id: string): string {
  return `account:pk:${id}`
}

export function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    walletId: row.wallet_id,
    walletType: row.wallet_type as WalletType,
    networkScope: row.network_scope as NetworkScope,
    addressType: (row.address_type as BitcoinAddressType | null) ?? null,
    rootPath: row.root_path,
    accountIndex: row.account_index,
    addressIndex: row.address_index,
    address: row.address,
    publicKey: row.public_key,
    label: row.label,
    source: row.source as AccountSource,
    createdAt: row.created_at,
  }
}

export function listAccountRows(walletId?: string | null): AccountRow[] {
  const db = getDatabase()
  if (walletId === undefined) {
    return db
      .prepare<[], AccountRow>(
        `SELECT * FROM accounts
         ORDER BY wallet_id IS NULL, wallet_id, wallet_type, network_scope, address_type, account_index, address_index`,
      )
      .all()
  }
  if (walletId === null) {
    return db
      .prepare<[], AccountRow>(
        `SELECT * FROM accounts WHERE wallet_id IS NULL
         ORDER BY wallet_type, created_at`,
      )
      .all()
  }
  return db
    .prepare<[string], AccountRow>(
      `SELECT * FROM accounts WHERE wallet_id = ?
       ORDER BY wallet_type, network_scope, address_type, account_index, address_index`,
    )
    .all(walletId)
}

export function countAccounts(walletId: string): number {
  const row = getDatabase()
    .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM accounts WHERE wallet_id = ?')
    .get(walletId)
  return row?.n ?? 0
}

export function getAccountRow(id: string): AccountRow | null {
  return (
    getDatabase().prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?').get(id) ??
    null
  )
}

export function findAccountByAddress(
  walletType: WalletType,
  networkScope: NetworkScope,
  address: string,
): AccountRow | null {
  return (
    getDatabase()
      .prepare<[string, string, string], AccountRow>(
        'SELECT * FROM accounts WHERE wallet_type = ? AND network_scope = ? AND address = ?',
      )
      .get(walletType, networkScope, address) ?? null
  )
}

export function insertAccount(input: {
  id: string
  walletId: string | null
  walletType: WalletType
  networkScope: NetworkScope
  addressType: BitcoinAddressType | null
  rootPath: string | null
  accountIndex: number
  addressIndex: number
  address: string
  publicKey: string
  label: string | null
  source: AccountSource
  privateKeyHex?: string | null
}): AccountRow {
  const now = Date.now()
  const encrypted =
    input.source === 'imported' && input.privateKeyHex
      ? encryptWithVault(input.privateKeyHex, aadOf(input.id))
      : null
  getDatabase()
    .prepare(
      `INSERT INTO accounts (
         id, wallet_id, wallet_type, network_scope, address_type, root_path,
         account_index, address_index, address, public_key, label, source,
         encrypted_private_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.walletId,
      input.walletType,
      input.networkScope,
      input.addressType,
      input.rootPath,
      input.accountIndex,
      input.addressIndex,
      input.address,
      input.publicKey,
      input.label,
      input.source,
      encrypted,
      now,
      now,
    )
  return getAccountRow(input.id) as AccountRow
}

export function decryptImportedPrivateKey(row: AccountRow): string {
  if (row.source !== 'imported' || !row.encrypted_private_key) {
    throw new Error('该账户不是导入私钥账户')
  }
  return decryptWithVault(row.encrypted_private_key, aadOf(row.id))
}

export function updateAccountLabel(id: string, label: string | null): void {
  getDatabase()
    .prepare('UPDATE accounts SET label = ?, updated_at = ? WHERE id = ?')
    .run(label, Date.now(), id)
}

export function deleteAccount(id: string): void {
  getDatabase().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

/**
 * 为某条链挑付款账户。
 * EVM / TRON 主网与测试网共用同一地址，创建钱包时只派生了 mainnet 行，
 * 切到 Sepolia / Nile 时应回落到同类型账户，而不是提示「未派生」。
 * Bitcoin 主网/测试网地址不同，必须精确匹配 networkScope。
 */
export function getActiveWalletId(): string | null {
  const fromSettings = loadSettings().defaultWalletId
  if (fromSettings) return fromSettings
  const row = getDatabase()
    .prepare<[], { id: string }>('SELECT id FROM wallets WHERE is_default = 1 LIMIT 1')
    .get()
  return row?.id ?? null
}

export function listMatchingAccounts(input: {
  walletType: WalletType
  networkScope: NetworkScope
  addressType?: BitcoinAddressType | null
  walletId?: string | null
}): AccountRow[] {
  const sameType = listAccountRows().filter((row) => row.wallet_type === input.walletType)
  const sameScope = sameType.filter((row) => row.network_scope === input.networkScope)
  const pool = input.walletType === 'bitcoin' || sameScope.length > 0 ? sameScope : sameType
  let typed =
    input.walletType === 'bitcoin' && input.addressType
      ? pool.filter((row) => row.address_type === input.addressType)
      : pool

  const activeId = input.walletId === undefined ? getActiveWalletId() : input.walletId
  if (activeId) {
    typed = typed.filter((row) => row.wallet_id === activeId)
  }

  return [...typed].sort((a, b) => {
    const aScope = a.network_scope === input.networkScope ? 0 : 1
    const bScope = b.network_scope === input.networkScope ? 0 : 1
    return aScope - bScope
  })
}

export function findMatchingAccount(input: {
  walletType: WalletType
  networkScope: NetworkScope
  addressType?: BitcoinAddressType | null
}): AccountRow | null {
  return listMatchingAccounts(input)[0] ?? null
}

export function findNextAddressIndex(
  walletId: string,
  walletType: WalletType,
  networkScope: NetworkScope,
  addressType: BitcoinAddressType | null,
  accountIndex: number,
): number {
  const row = getDatabase()
    .prepare<[string, string, string, string | null, number], { n: number | null }>(
      `SELECT MAX(address_index) AS n FROM accounts
       WHERE wallet_id = ? AND wallet_type = ? AND network_scope = ?
         AND IFNULL(address_type, '') = IFNULL(?, '') AND account_index = ? AND source = 'hd'`,
    )
    .get(walletId, walletType, networkScope, addressType, accountIndex)
  return (row?.n ?? -1) + 1
}

export function reencryptImportedAccounts(oldKek: Buffer, newKek: Buffer): void {
  const db = getDatabase()
  const rows = db
    .prepare<[], AccountRow>(
      "SELECT * FROM accounts WHERE source = 'imported' AND encrypted_private_key IS NOT NULL",
    )
    .all()
  const update = db.prepare('UPDATE accounts SET encrypted_private_key = ? WHERE id = ?')
  for (const row of rows) {
    if (!row.encrypted_private_key) continue
    const hex = decryptSecret(oldKek, row.encrypted_private_key, aadOf(row.id))
    update.run(encryptSecret(newKek, hex, aadOf(row.id)), row.id)
  }
}
