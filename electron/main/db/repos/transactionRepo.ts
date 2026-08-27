/**
 * 本地交易记录。
 */
import type { TransactionRecord } from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface TxRow {
  id: string
  network_pk: string
  account_id: string
  txid: string
  direction: string
  from_address: string
  to_address: string
  token_pk: string | null
  symbol: string
  amount: string
  fee: string | null
  status: string
  block_height: number | null
  raw_hex: string | null
  submitted_to_backend: number
  explorer_url: string | null
  created_at: number
  updated_at: number
}

function toRecord(row: TxRow): TransactionRecord {
  return {
    id: row.id,
    networkPk: row.network_pk,
    accountId: row.account_id,
    txid: row.txid,
    direction: row.direction as TransactionRecord['direction'],
    fromAddress: row.from_address,
    toAddress: row.to_address,
    tokenPk: row.token_pk,
    symbol: row.symbol,
    amount: row.amount,
    fee: row.fee,
    status: row.status as TransactionRecord['status'],
    blockHeight: row.block_height,
    rawHex: row.raw_hex,
    submittedToBackend: row.submitted_to_backend === 1,
    createdAt: row.created_at,
    explorerUrl: row.explorer_url,
  }
}

export function insertTransaction(input: Omit<TransactionRecord, 'submittedToBackend'> & { submittedToBackend?: boolean }): TransactionRecord {
  const now = Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO transactions (
         id, network_pk, account_id, txid, direction, from_address, to_address, token_pk,
         symbol, amount, fee, status, block_height, raw_hex, submitted_to_backend,
         explorer_url, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(network_pk, txid, account_id) DO UPDATE SET
         direction = excluded.direction,
         from_address = excluded.from_address,
         to_address = excluded.to_address,
         token_pk = COALESCE(excluded.token_pk, token_pk),
         symbol = excluded.symbol,
         amount = excluded.amount,
         fee = COALESCE(excluded.fee, fee),
         status = excluded.status,
         block_height = COALESCE(excluded.block_height, block_height),
         explorer_url = COALESCE(excluded.explorer_url, explorer_url),
         created_at = MIN(created_at, excluded.created_at),
         updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.networkPk,
      input.accountId,
      input.txid,
      input.direction,
      input.fromAddress,
      input.toAddress,
      input.tokenPk,
      input.symbol,
      input.amount,
      input.fee,
      input.status,
      input.blockHeight,
      input.rawHex,
      input.submittedToBackend ? 1 : 0,
      input.explorerUrl,
      input.createdAt ?? now,
      now,
    )
  const row = getDatabase()
    .prepare<[string, string, string], TxRow>(
      'SELECT * FROM transactions WHERE network_pk = ? AND txid = ? AND account_id = ?',
    )
    .get(input.networkPk, input.txid, input.accountId)
  return row ? toRecord(row) : (getTransaction(input.id) as TransactionRecord)
}

export const upsertTransaction = insertTransaction

export function getTransaction(id: string): TransactionRecord | null {
  const row = getDatabase().prepare<[string], TxRow>('SELECT * FROM transactions WHERE id = ?').get(id)
  return row ? toRecord(row) : null
}

export function listTransactions(query?: { accountId?: string; networkPk?: string }): TransactionRecord[] {
  const db = getDatabase()
  const accountId = query?.accountId
  const networkPk = query?.networkPk
  const rows = accountId && networkPk
    ? db
        .prepare<[string, string], TxRow>(
          'SELECT * FROM transactions WHERE account_id = ? AND network_pk = ? ORDER BY created_at DESC LIMIT 200',
        )
        .all(accountId, networkPk)
    : accountId
      ? db
          .prepare<[string], TxRow>(
            'SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 200',
          )
          .all(accountId)
      : networkPk
        ? db
            .prepare<[string], TxRow>(
              'SELECT * FROM transactions WHERE network_pk = ? ORDER BY created_at DESC LIMIT 200',
            )
            .all(networkPk)
        : db.prepare<[], TxRow>('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200').all()
  return rows.map(toRecord)
}

export function markTransactionReported(id: string): void {
  getDatabase()
    .prepare('UPDATE transactions SET submitted_to_backend = 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), id)
}
