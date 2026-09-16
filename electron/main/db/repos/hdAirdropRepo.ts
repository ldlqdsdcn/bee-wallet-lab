/**
 * 分层钱包批量转账：任务头 + 每一笔明细，方便失败重试。
 */
import type {
  HdAirdropItem,
  HdAirdropItemQuery,
  HdAirdropItemPage,
  HdAirdropItemStatus,
  HdAirdropJob,
  HdAirdropJobKind,
  HdAirdropJobStatus,
} from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface JobRow {
  id: string
  wallet_id: string
  account_id: string
  network_pk: string
  token_pk: string
  from_address: string
  symbol: string
  decimals: number
  job_kind?: string | null
  amount_mode: string
  amount_text: string
  from_index: number
  to_index: number
  account_index: number
  status: string
  total: number
  queued: number
  pending: number
  confirmed: number
  failed: number
  skipped: number
  current_index: number | null
  last_txid: string | null
  last_error: string | null
  estimated_ms: number
  started_at: number
  finished_at: number | null
  created_at: number
  updated_at: number
}

interface ItemRow {
  id: string
  job_id: string
  address_index: number
  to_address: string
  to_name?: string | null
  amount: string
  amount_minor: string
  status: string
  txid: string | null
  explorer_url: string | null
  error: string | null
  attempt_count: number
  created_at: number
  updated_at: number
}

export function toJob(row: JobRow): HdAirdropJob {
  return {
    id: row.id,
    walletId: row.wallet_id,
    accountId: row.account_id,
    networkPk: row.network_pk,
    tokenPk: row.token_pk,
    fromAddress: row.from_address,
    symbol: row.symbol,
    decimals: row.decimals,
    jobKind: row.job_kind === 'itemized' ? 'itemized' : 'uniform',
    amountMode: row.amount_mode as HdAirdropJob['amountMode'],
    amountText: row.amount_text,
    fromIndex: row.from_index,
    toIndex: row.to_index,
    accountIndex: row.account_index,
    status: row.status as HdAirdropJobStatus,
    total: row.total,
    queued: row.queued,
    pending: row.pending,
    confirmed: row.confirmed,
    sent: row.pending + row.confirmed,
    failed: row.failed,
    skipped: row.skipped,
    currentIndex: row.current_index,
    lastTxid: row.last_txid,
    lastError: row.last_error,
    estimatedMs: row.estimated_ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }
}

export function toItem(row: ItemRow): HdAirdropItem {
  return {
    id: row.id,
    jobId: row.job_id,
    addressIndex: row.address_index,
    toAddress: row.to_address,
    toName: row.to_name ?? null,
    amount: row.amount,
    amountMinor: row.amount_minor,
    status: row.status as HdAirdropItemStatus,
    txid: row.txid,
    explorerUrl: row.explorer_url,
    error: row.error,
    attemptCount: row.attempt_count,
    updatedAt: row.updated_at,
  }
}

export function insertHdAirdropJob(
  input: Omit<HdAirdropJob, 'sent' | 'createdAt'> & { createdAt?: number },
): HdAirdropJob {
  const now = input.createdAt ?? Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO hd_airdrop_jobs (
         id, wallet_id, account_id, network_pk, token_pk, from_address, symbol, decimals,
         job_kind, amount_mode, amount_text, from_index, to_index, account_index, status,
         total, queued, pending, confirmed, failed, skipped,
         current_index, last_txid, last_error, estimated_ms,
         started_at, finished_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.walletId,
      input.accountId,
      input.networkPk,
      input.tokenPk,
      input.fromAddress,
      input.symbol,
      input.decimals,
      input.jobKind ?? 'uniform',
      input.amountMode,
      input.amountText,
      input.fromIndex,
      input.toIndex,
      input.accountIndex,
      input.status,
      input.total,
      input.queued,
      input.pending,
      input.confirmed,
      input.failed,
      input.skipped,
      input.currentIndex,
      input.lastTxid,
      input.lastError,
      input.estimatedMs,
      input.startedAt,
      input.finishedAt,
      now,
      now,
    )
  return getHdAirdropJob(input.id)!
}

export function insertHdAirdropItems(
  items: Array<
    Omit<HdAirdropItem, 'updatedAt'> & {
      updatedAt?: number
      createdAt?: number
    }
  >,
): number {
  if (items.length === 0) return 0
  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO hd_airdrop_items (
       id, job_id, address_index, to_address, to_name, amount, amount_minor, status,
       txid, explorer_url, error, attempt_count, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const now = Date.now()
  const apply = db.transaction(() => {
    for (const item of items) {
      const at = item.createdAt ?? now
      stmt.run(
        item.id,
        item.jobId,
        item.addressIndex,
        item.toAddress,
        item.toName ?? null,
        item.amount,
        item.amountMinor,
        item.status,
        item.txid,
        item.explorerUrl,
        item.error,
        item.attemptCount,
        at,
        item.updatedAt ?? at,
      )
    }
    return items.length
  })
  return apply()
}

export function getHdAirdropJob(id: string): HdAirdropJob | null {
  const row = getDatabase().prepare<[string], JobRow>('SELECT * FROM hd_airdrop_jobs WHERE id = ?').get(id)
  return row ? toJob(row) : null
}

export function listHdAirdropJobs(
  walletId?: string,
  networkPk?: string,
  jobKind?: HdAirdropJobKind,
): HdAirdropJob[] {
  const db = getDatabase()
  const kind = jobKind === 'itemized' || jobKind === 'uniform' ? jobKind : undefined
  if (walletId && networkPk && kind) {
    return db
      .prepare<[string, string, string], JobRow>(
        `SELECT * FROM hd_airdrop_jobs
         WHERE wallet_id = ? AND network_pk = ? AND job_kind = ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all(walletId, networkPk, kind)
      .map(toJob)
  }
  if (walletId && networkPk) {
    return db
      .prepare<[string, string], JobRow>(
        `SELECT * FROM hd_airdrop_jobs
         WHERE wallet_id = ? AND network_pk = ?
         ORDER BY created_at DESC LIMIT 50`,
      )
      .all(walletId, networkPk)
      .map(toJob)
  }
  if (walletId && kind) {
    return db
      .prepare<[string, string], JobRow>(
        `SELECT * FROM hd_airdrop_jobs WHERE wallet_id = ? AND job_kind = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(walletId, kind)
      .map(toJob)
  }
  if (walletId) {
    return db
      .prepare<[string], JobRow>(
        `SELECT * FROM hd_airdrop_jobs WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .all(walletId)
      .map(toJob)
  }
  return db
    .prepare<[], JobRow>('SELECT * FROM hd_airdrop_jobs ORDER BY created_at DESC LIMIT 50')
    .all()
    .map(toJob)
}

export function listRunningHdAirdropJobs(): HdAirdropJob[] {
  return getDatabase()
    .prepare<[], JobRow>(`SELECT * FROM hd_airdrop_jobs WHERE status = 'running'`)
    .all()
    .map(toJob)
}

export function updateHdAirdropJob(
  id: string,
  patch: Partial<
    Pick<
      HdAirdropJob,
      | 'status'
      | 'queued'
      | 'pending'
      | 'confirmed'
      | 'failed'
      | 'skipped'
      | 'currentIndex'
      | 'lastTxid'
      | 'lastError'
      | 'finishedAt'
      | 'estimatedMs'
    >
  >,
): HdAirdropJob | null {
  const current = getHdAirdropJob(id)
  if (!current) return null
  const next = { ...current, ...patch }
  getDatabase()
    .prepare(
      `UPDATE hd_airdrop_jobs SET
         status = ?, queued = ?, pending = ?, confirmed = ?, failed = ?, skipped = ?,
         current_index = ?, last_txid = ?, last_error = ?, estimated_ms = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.status,
      next.queued,
      next.pending,
      next.confirmed,
      next.failed,
      next.skipped,
      next.currentIndex,
      next.lastTxid,
      next.lastError,
      next.estimatedMs,
      next.finishedAt,
      Date.now(),
      id,
    )
  return getHdAirdropJob(id)
}

export function getHdAirdropItem(id: string): HdAirdropItem | null {
  const row = getDatabase().prepare<[string], ItemRow>('SELECT * FROM hd_airdrop_items WHERE id = ?').get(id)
  return row ? toItem(row) : null
}

export function findHdAirdropItemByTxid(txid: string): HdAirdropItem | null {
  const row = getDatabase()
    .prepare<[string], ItemRow>('SELECT * FROM hd_airdrop_items WHERE lower(txid) = lower(?)')
    .get(txid)
  return row ? toItem(row) : null
}

export function listHdAirdropItemsByIds(jobId: string, ids: string[]): HdAirdropItem[] {
  if (ids.length === 0) return []
  const db = getDatabase()
  const stmt = db.prepare<[string, string], ItemRow>(
    'SELECT * FROM hd_airdrop_items WHERE job_id = ? AND id = ?',
  )
  return ids
    .map((id) => stmt.get(jobId, id))
    .filter((row): row is ItemRow => Boolean(row))
    .map(toItem)
}

export function listHdAirdropItemsByStatus(jobId: string, statuses: HdAirdropItemStatus[]): HdAirdropItem[] {
  if (statuses.length === 0) return []
  const placeholders = statuses.map(() => '?').join(', ')
  return getDatabase()
    .prepare<unknown[], ItemRow>(
      `SELECT * FROM hd_airdrop_items
       WHERE job_id = ? AND status IN (${placeholders})
       ORDER BY address_index`,
    )
    .all(jobId, ...statuses)
    .map(toItem)
}

export function listHdAirdropItemPage(query: HdAirdropItemQuery): HdAirdropItemPage {
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 50))
  const page = Math.max(1, query.page ?? 1)
  const db = getDatabase()
  const counts = countHdAirdropItems(query.jobId)
  const filtered = query.status
    ? (counts[query.status] ?? 0)
    : counts.queued + counts.pending + counts.confirmed + counts.failed + counts.skipped
  const offset = (page - 1) * pageSize
  const rows = query.status
    ? db
        .prepare<[string, string, number, number], ItemRow>(
          `SELECT * FROM hd_airdrop_items
           WHERE job_id = ? AND status = ?
           ORDER BY address_index LIMIT ? OFFSET ?`,
        )
        .all(query.jobId, query.status, pageSize, offset)
    : db
        .prepare<[string, number, number], ItemRow>(
          `SELECT * FROM hd_airdrop_items
           WHERE job_id = ? ORDER BY address_index LIMIT ? OFFSET ?`,
        )
        .all(query.jobId, pageSize, offset)
  return {
    jobId: query.jobId,
    items: rows.map(toItem),
    total: filtered,
    page,
    pageSize,
    ...counts,
  }
}

export function countHdAirdropItems(jobId: string): {
  queued: number
  pending: number
  confirmed: number
  failed: number
  skipped: number
} {
  const rows = getDatabase()
    .prepare<[string], { status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM hd_airdrop_items WHERE job_id = ? GROUP BY status',
    )
    .all(jobId)
  const counts = { queued: 0, pending: 0, confirmed: 0, failed: 0, skipped: 0 }
  for (const row of rows) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row.n
  }
  return counts
}

export function refreshHdAirdropJobCounts(jobId: string): HdAirdropJob | null {
  const counts = countHdAirdropItems(jobId)
  return updateHdAirdropJob(jobId, counts)
}

export function updateHdAirdropItem(
  id: string,
  patch: Partial<
    Pick<HdAirdropItem, 'status' | 'txid' | 'explorerUrl' | 'error' | 'attemptCount'>
  >,
): HdAirdropItem | null {
  const current = getHdAirdropItem(id)
  if (!current) return null
  const next = { ...current, ...patch }
  getDatabase()
    .prepare(
      `UPDATE hd_airdrop_items SET
         status = ?, txid = ?, explorer_url = ?, error = ?, attempt_count = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(next.status, next.txid, next.explorerUrl, next.error, next.attemptCount, Date.now(), id)
  return getHdAirdropItem(id)
}
