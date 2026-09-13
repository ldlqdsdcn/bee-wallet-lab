/**
 * 用户维护的 HTTP / SOCKS 代理列表。
 */
import type { ProxyRecord } from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface ProxyRow {
  id: string
  url: string
  label: string | null
  is_selected: number
  last_latency_ms: number | null
  last_error: string | null
  last_checked_at: number | null
  created_at: number
}

function toRecord(row: ProxyRow): ProxyRecord {
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    isSelected: row.is_selected === 1,
    lastLatencyMs: row.last_latency_ms,
    lastError: row.last_error,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  }
}

export function listProxies(): ProxyRecord[] {
  return getDatabase()
    .prepare<[], ProxyRow>(
      `SELECT * FROM proxies ORDER BY created_at ASC, id ASC`,
    )
    .all()
    .map(toRecord)
}

export function getProxy(id: string): ProxyRecord | null {
  const row = getDatabase().prepare<[string], ProxyRow>('SELECT * FROM proxies WHERE id = ?').get(id)
  return row ? toRecord(row) : null
}

export function findProxyByUrl(url: string): ProxyRecord | null {
  const row = getDatabase().prepare<[string], ProxyRow>('SELECT * FROM proxies WHERE url = ?').get(url)
  return row ? toRecord(row) : null
}

export function selectedProxy(): ProxyRecord | null {
  const row = getDatabase()
    .prepare<[], ProxyRow>('SELECT * FROM proxies WHERE is_selected = 1 LIMIT 1')
    .get()
  return row ? toRecord(row) : null
}

export function insertProxy(input: {
  id: string
  url: string
  label: string | null
  isSelected: boolean
}): ProxyRecord {
  const now = Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO proxies (
         id, url, label, is_selected, last_latency_ms, last_error, last_checked_at, created_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)`,
    )
    .run(input.id, input.url, input.label, input.isSelected ? 1 : 0, now)
  return getProxy(input.id) as ProxyRecord
}

export function deleteProxy(id: string): void {
  getDatabase().prepare('DELETE FROM proxies WHERE id = ?').run(id)
}

export function clearProxySelection(): void {
  getDatabase().prepare('UPDATE proxies SET is_selected = 0').run()
}

export function setProxySelected(id: string): void {
  const db = getDatabase()
  const apply = db.transaction(() => {
    db.prepare('UPDATE proxies SET is_selected = 0').run()
    db.prepare('UPDATE proxies SET is_selected = 1 WHERE id = ?').run(id)
  })
  apply()
}

export function updateProxyRow(
  id: string,
  input: { url: string; label: string | null; clearPing: boolean },
): void {
  if (input.clearPing) {
    getDatabase()
      .prepare(
        `UPDATE proxies
         SET url = ?, label = ?, last_latency_ms = NULL, last_error = NULL, last_checked_at = NULL
         WHERE id = ?`,
      )
      .run(input.url, input.label, id)
    return
  }
  getDatabase().prepare('UPDATE proxies SET url = ?, label = ? WHERE id = ?').run(input.url, input.label, id)
}

export function updateProxyPing(id: string, input: { latencyMs: number | null; error: string | null }): void {
  getDatabase()
    .prepare('UPDATE proxies SET last_latency_ms = ?, last_error = ?, last_checked_at = ? WHERE id = ?')
    .run(input.latencyMs, input.error, Date.now(), id)
}
