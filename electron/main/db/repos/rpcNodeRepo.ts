/**
 * 每个网络的 RPC 节点列表。URL 是公开节点地址，不加密。
 */
import type { RpcNodeRecord, RpcNodeSource } from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface RpcNodeRow {
  id: string
  network_pk: string
  url: string
  label: string | null
  source: string
  is_selected: number
  last_latency_ms: number | null
  last_error: string | null
  last_checked_at: number | null
  created_at: number
}

export function toRpcNodeRecord(row: RpcNodeRow): RpcNodeRecord {
  return {
    id: row.id,
    networkPk: row.network_pk,
    url: row.url,
    label: row.label,
    source: row.source as RpcNodeSource,
    isSelected: row.is_selected === 1,
    lastLatencyMs: row.last_latency_ms,
    lastError: row.last_error,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  }
}

export function listRpcNodes(networkPk: string): RpcNodeRecord[] {
  return getDatabase()
    .prepare<[string], RpcNodeRow>(
      `SELECT * FROM rpc_nodes WHERE network_pk = ?
       ORDER BY is_selected DESC, source ASC, created_at ASC`,
    )
    .all(networkPk)
    .map(toRpcNodeRecord)
}

export function getRpcNode(id: string): RpcNodeRecord | null {
  const row = getDatabase()
    .prepare<[string], RpcNodeRow>('SELECT * FROM rpc_nodes WHERE id = ?')
    .get(id)
  return row ? toRpcNodeRecord(row) : null
}

export function findRpcNode(networkPk: string, url: string): RpcNodeRecord | null {
  const row = getDatabase()
    .prepare<[string, string], RpcNodeRow>('SELECT * FROM rpc_nodes WHERE network_pk = ? AND url = ?')
    .get(networkPk, url)
  return row ? toRpcNodeRecord(row) : null
}

export function selectedRpcNode(networkPk: string): RpcNodeRecord | null {
  const row = getDatabase()
    .prepare<[string], RpcNodeRow>(
      'SELECT * FROM rpc_nodes WHERE network_pk = ? AND is_selected = 1 LIMIT 1',
    )
    .get(networkPk)
  return row ? toRpcNodeRecord(row) : null
}

export function insertRpcNode(input: {
  id: string
  networkPk: string
  url: string
  label: string | null
  source: RpcNodeSource
  isSelected: boolean
}): RpcNodeRecord {
  const now = Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO rpc_nodes (
         id, network_pk, url, label, source, is_selected,
         last_latency_ms, last_error, last_checked_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    )
    .run(input.id, input.networkPk, input.url, input.label, input.source, input.isSelected ? 1 : 0, now)
  return getRpcNode(input.id) as RpcNodeRecord
}

export function deleteRpcNode(id: string): void {
  getDatabase().prepare('DELETE FROM rpc_nodes WHERE id = ?').run(id)
}

export function deleteBuiltinRpcNodes(networkPk: string): void {
  getDatabase().prepare("DELETE FROM rpc_nodes WHERE network_pk = ? AND source = 'builtin'").run(networkPk)
}

export function deleteRpcNodesByNetwork(networkPk: string): void {
  getDatabase().prepare('DELETE FROM rpc_nodes WHERE network_pk = ?').run(networkPk)
}

export function clearRpcSelection(networkPk: string): void {
  getDatabase().prepare('UPDATE rpc_nodes SET is_selected = 0 WHERE network_pk = ?').run(networkPk)
}

export function setRpcSelected(id: string, networkPk: string): void {
  const db = getDatabase()
  const apply = db.transaction(() => {
    db.prepare('UPDATE rpc_nodes SET is_selected = 0 WHERE network_pk = ?').run(networkPk)
    db.prepare('UPDATE rpc_nodes SET is_selected = 1 WHERE id = ?').run(id)
  })
  apply()
}

export function updateRpcPing(id: string, input: { latencyMs: number | null; error: string | null }): void {
  getDatabase()
    .prepare('UPDATE rpc_nodes SET last_latency_ms = ?, last_error = ?, last_checked_at = ? WHERE id = ?')
    .run(input.latencyMs, input.error, Date.now(), id)
}
