/**
 * 链上确认后回写批量转账明细。不弹系统通知，避免两万笔把桌面刷爆。
 */
import { IPC_EVENT } from '../../../shared/ipc'
import type { TransactionRecord } from '../../../shared/types'
import {
  findHdAirdropItemByTxid,
  getHdAirdropJob,
  refreshHdAirdropJobCounts,
  updateHdAirdropItem,
  updateHdAirdropJob,
} from '../db/repos/hdAirdropRepo'
import { broadcast } from '../ipc/registry'

export function isHdAirdropTxid(txid: string): boolean {
  return Boolean(findHdAirdropItemByTxid(txid))
}

export function settleHdAirdropByTxid(txid: string, status: 'confirmed' | 'failed'): void {
  const item = findHdAirdropItemByTxid(txid)
  if (!item || item.status !== 'pending') return
  updateHdAirdropItem(item.id, {
    status,
    error: status === 'failed' ? item.error ?? '链上执行失败' : null,
  })
  const job = refreshHdAirdropJobCounts(item.jobId)
  if (job && job.status !== 'running') {
    const nextStatus =
      job.queued === 0 && job.pending === 0
        ? job.confirmed === 0 && job.failed > 0
          ? 'failed'
          : job.status === 'stopped'
            ? 'stopped'
            : 'done'
        : job.status
    if (nextStatus !== job.status) updateHdAirdropJob(job.id, { status: nextStatus })
  }
  const latest = getHdAirdropJob(item.jobId)
  if (latest) broadcast(IPC_EVENT.hdAirdropProgress, latest)
}

export function settleHdAirdropFromRecord(record: TransactionRecord): void {
  if (record.status !== 'confirmed' && record.status !== 'failed') return
  settleHdAirdropByTxid(record.txid, record.status)
}
