/**
 * 余额缓存。key 与 AssetEntry.key 一致。
 */
import { getDatabase } from '../sqlite'

export interface BalanceCacheRow {
  entry_key: string
  network_pk: string
  token_pk: string
  account_id: string | null
  address: string | null
  address_type: string | null
  balance: string
  unconfirmed: string | null
  currency_code: string | null
  currency_balance: string | null
  updated_at: number
}

export function loadBalances(networkPk: string, currencyCode: string): BalanceCacheRow[] {
  return getDatabase()
    .prepare<[string, string, string], BalanceCacheRow>(
      'SELECT * FROM balances_cache WHERE network_pk = ? AND IFNULL(currency_code, ?) = ?',
    )
    .all(networkPk, currencyCode, currencyCode)
}

export function upsertBalance(row: Omit<BalanceCacheRow, never>): void {
  getDatabase()
    .prepare(
      `INSERT INTO balances_cache (
         entry_key, network_pk, token_pk, account_id, address, address_type,
         balance, unconfirmed, currency_code, currency_balance, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_key) DO UPDATE SET
         network_pk = excluded.network_pk,
         token_pk = excluded.token_pk,
         account_id = excluded.account_id,
         address = excluded.address,
         address_type = excluded.address_type,
         balance = excluded.balance,
         unconfirmed = excluded.unconfirmed,
         currency_code = excluded.currency_code,
         currency_balance = excluded.currency_balance,
         updated_at = excluded.updated_at`,
    )
    .run(
      row.entry_key,
      row.network_pk,
      row.token_pk,
      row.account_id,
      row.address,
      row.address_type,
      row.balance,
      row.unconfirmed,
      row.currency_code,
      row.currency_balance,
      row.updated_at,
    )
}

export function loadBalance(entryKey: string): BalanceCacheRow | null {
  return (
    getDatabase()
      .prepare<[string], BalanceCacheRow>('SELECT * FROM balances_cache WHERE entry_key = ?')
      .get(entryKey) ?? null
  )
}
