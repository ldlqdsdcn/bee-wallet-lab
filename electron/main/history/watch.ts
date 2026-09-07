/**
 * 后台轮询 pending 交易；上链成功或失败后发系统通知。
 */
import { BrowserWindow, Notification } from 'electron'
import { IPC_EVENT } from '../../../shared/ipc'
import type { TransactionRecord } from '../../../shared/types'
import { getNetwork } from '../db/repos/catalogRepo'
import {
  listPendingTransactions,
  onTransactionSettled,
  updateTransactionStatus,
} from '../db/repos/transactionRepo'
import { loadAppIcon } from '../icon'
import { broadcast } from '../ipc/registry'
import { tryFinalizeIssuedToken } from '../token/pending'
import { isHdAirdropTxid, settleHdAirdropFromRecord } from '../hdAirdrop/pending'
import { fetchTransactionStatus } from './status'

const MAX_AGE_MS = 24 * 60 * 60 * 1000
const TICK_MS = 8_000

const lastPolled = new Map<string, number>()
let timer: NodeJS.Timeout | null = null
let ticking = false
let unsubscribeSettled: (() => void) | null = null

function intervalFor(createdAt: number): number {
  const age = Date.now() - createdAt
  if (age < 2 * 60_000) return 8_000
  if (age < 15 * 60_000) return 20_000
  return 60_000
}

function focusActivity(): void {
  const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  broadcast(IPC_EVENT.appCommand, { action: 'navigate', path: '/activity' })
}

function notifySettled(record: TransactionRecord): void {
  broadcast(IPC_EVENT.transactionUpdated, { record, previousStatus: 'pending' })
  settleHdAirdropFromRecord(record)
  if (isHdAirdropTxid(record.txid)) return
  if (!Notification.isSupported()) return
  const ok = record.status === 'confirmed'
  const verb = record.direction === 'receive' ? '收入' : '支出'
  const icon = loadAppIcon()
  const notification = new Notification({
    title: ok ? '交易已确认' : '交易失败',
    body: `${verb} ${record.amount} ${record.symbol}`,
    ...(icon ? { icon } : {}),
  })
  notification.on('click', () => focusActivity())
  notification.show()
}

async function pollOne(record: TransactionRecord): Promise<void> {
  if (Date.now() - record.createdAt > MAX_AGE_MS) return
  const network = getNetwork(record.networkPk)
  if (!network) return
  lastPolled.set(record.id, Date.now())
  const next = await fetchTransactionStatus(network, record.txid)
  if (next.status === 'pending') return
  lastPolled.delete(record.id)
  updateTransactionStatus(record.id, next.status, next.blockHeight)
  if (network.walletType === 'web3') {
    await tryFinalizeIssuedToken(network, record.txid)
  }
}

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const now = Date.now()
    const due = listPendingTransactions().filter((item) => {
      if (now - item.createdAt > MAX_AGE_MS) return false
      const prev = lastPolled.get(item.id) ?? 0
      return now - prev >= intervalFor(item.createdAt)
    })
    await Promise.allSettled(due.slice(0, 8).map((item) => pollOne(item)))
  } catch (err) {
    console.warn('[tx-watch]', err instanceof Error ? err.message : err)
  } finally {
    ticking = false
  }
}

export function watchTransaction(record: TransactionRecord): void {
  if (record.status !== 'pending') return
  void pollOne(record).catch(() => undefined)
}

export function startTransactionWatch(): void {
  if (!unsubscribeSettled) {
    unsubscribeSettled = onTransactionSettled((next) => notifySettled(next))
  }
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), TICK_MS)
}

export function stopTransactionWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  ticking = false
}

export function disposeTransactionWatch(): void {
  stopTransactionWatch()
  lastPolled.clear()
  unsubscribeSettled?.()
  unsubscribeSettled = null
}
