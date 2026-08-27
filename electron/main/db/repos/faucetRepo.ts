/**
 * 测试网水龙头。URL 是公开地址，不加密。
 */
import type { CatalogSource, FaucetRecord } from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface FaucetRow {
  id: string
  network_pk: string
  url: string
  label: string | null
  source: string
  sort_order: number
  created_at: number
  updated_at: number
}

function toRecord(row: FaucetRow): FaucetRecord {
  return {
    id: row.id,
    networkPk: row.network_pk,
    url: row.url,
    label: row.label,
    source: row.source === 'custom' ? 'custom' : 'builtin',
    createdAt: row.created_at,
  }
}

export function listFaucets(networkPk: string): FaucetRecord[] {
  return getDatabase()
    .prepare<[string], FaucetRow>(
      `SELECT * FROM faucets WHERE network_pk = ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all(networkPk)
    .map(toRecord)
}

export function getFaucet(id: string): FaucetRecord | null {
  const row = getDatabase().prepare<[string], FaucetRow>('SELECT * FROM faucets WHERE id = ?').get(id)
  return row ? toRecord(row) : null
}

export function findFaucet(networkPk: string, url: string): FaucetRecord | null {
  const row = getDatabase()
    .prepare<[string, string], FaucetRow>('SELECT * FROM faucets WHERE network_pk = ? AND url = ?')
    .get(networkPk, url)
  return row ? toRecord(row) : null
}

export function nextFaucetSortOrder(networkPk: string): number {
  const row = getDatabase()
    .prepare<[string], { n: number | null }>('SELECT MAX(sort_order) AS n FROM faucets WHERE network_pk = ?')
    .get(networkPk)
  return (row?.n ?? -1) + 1
}

export function insertFaucet(input: {
  id: string
  networkPk: string
  url: string
  label: string | null
  source: CatalogSource
  sortOrder: number
}): FaucetRecord {
  const now = Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO faucets (id, network_pk, url, label, source, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.id, input.networkPk, input.url, input.label, input.source, input.sortOrder, now, now)
  return getFaucet(input.id) as FaucetRecord
}

export function updateFaucet(input: {
  id: string
  url: string
  label: string | null
}): FaucetRecord {
  getDatabase()
    .prepare('UPDATE faucets SET url = ?, label = ?, updated_at = ? WHERE id = ?')
    .run(input.url, input.label, Date.now(), input.id)
  return getFaucet(input.id) as FaucetRecord
}

export function deleteFaucet(id: string): void {
  getDatabase().prepare('DELETE FROM faucets WHERE id = ?').run(id)
}

export function deleteBuiltinFaucets(networkPk: string): void {
  getDatabase().prepare("DELETE FROM faucets WHERE network_pk = ? AND source = 'builtin'").run(networkPk)
}

export function deleteFaucetsByNetwork(networkPk: string): void {
  getDatabase().prepare('DELETE FROM faucets WHERE network_pk = ?').run(networkPk)
}
