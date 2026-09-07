/**
 * 本钱包部署过的固定总量 ERC-20。
 */
import type { IssuedTokenRecord } from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface IssueRow {
  id: string
  network_pk: string
  account_id: string
  token_pk: string | null
  transaction_id: string | null
  from_address: string
  name: string
  symbol: string
  decimals: number
  supply: string
  supply_minor: string
  contract_address: string | null
  txid: string
  explorer_url: string | null
  status: string
  created_at: number
  updated_at: number
}

function toRecord(row: IssueRow): IssuedTokenRecord {
  return {
    id: row.id,
    networkPk: row.network_pk,
    accountId: row.account_id,
    tokenPk: row.token_pk,
    transactionId: row.transaction_id,
    fromAddress: row.from_address,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    supply: row.supply,
    supplyMinor: row.supply_minor,
    contractAddress: row.contract_address,
    txid: row.txid,
    explorerUrl: row.explorer_url,
    status: row.status as IssuedTokenRecord['status'],
    createdAt: row.created_at,
  }
}

export function listTokenIssues(networkPk?: string): IssuedTokenRecord[] {
  const db = getDatabase()
  const rows = networkPk
    ? db
        .prepare<[string], IssueRow>(
          'SELECT * FROM token_issues WHERE network_pk = ? ORDER BY created_at DESC',
        )
        .all(networkPk)
    : db.prepare<[], IssueRow>('SELECT * FROM token_issues ORDER BY created_at DESC').all()
  return rows.map(toRecord)
}

export function getTokenIssue(id: string): IssuedTokenRecord | null {
  const row = getDatabase().prepare<[string], IssueRow>('SELECT * FROM token_issues WHERE id = ?').get(id)
  return row ? toRecord(row) : null
}

export function findTokenIssueByTxid(txid: string): IssuedTokenRecord | null {
  const row = getDatabase()
    .prepare<[string], IssueRow>('SELECT * FROM token_issues WHERE lower(txid) = lower(?)')
    .get(txid)
  return row ? toRecord(row) : null
}

export function insertTokenIssue(
  input: Omit<IssuedTokenRecord, 'createdAt'> & { createdAt?: number },
): IssuedTokenRecord {
  const now = input.createdAt ?? Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO token_issues (
         id, network_pk, account_id, token_pk, transaction_id, from_address,
         name, symbol, decimals, supply, supply_minor, contract_address,
         txid, explorer_url, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.networkPk,
      input.accountId,
      input.tokenPk,
      input.transactionId,
      input.fromAddress,
      input.name,
      input.symbol,
      input.decimals,
      input.supply,
      input.supplyMinor,
      input.contractAddress,
      input.txid,
      input.explorerUrl,
      input.status,
      now,
      now,
    )
  return getTokenIssue(input.id) as IssuedTokenRecord
}

export function updateTokenIssue(
  id: string,
  patch: Partial<
    Pick<IssuedTokenRecord, 'tokenPk' | 'contractAddress' | 'explorerUrl' | 'status' | 'transactionId'>
  >,
): IssuedTokenRecord | null {
  const existing = getTokenIssue(id)
  if (!existing) return null
  const next: IssuedTokenRecord = { ...existing, ...patch }
  getDatabase()
    .prepare(
      `UPDATE token_issues SET
         token_pk = ?, contract_address = ?, explorer_url = ?, status = ?,
         transaction_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.tokenPk,
      next.contractAddress,
      next.explorerUrl,
      next.status,
      next.transactionId,
      Date.now(),
      id,
    )
  return getTokenIssue(id)
}

export function deleteTokenIssuesByNetwork(networkPk: string): void {
  getDatabase().prepare('DELETE FROM token_issues WHERE network_pk = ?').run(networkPk)
}
