import { useEffect, useState } from 'react'
import { IPC_EVENT } from '@shared/ipc'
import type { TransactionRecord } from '@shared/types'
import { on, transferApi } from '../lib/bridge'
import { Alert, Button, Card } from '../components/ui'
import { AccountAddress } from '../components/AccountAddress'
import { explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useT, type MessageKey } from '../i18n'

function statusLabel(status: TransactionRecord['status']): MessageKey {
  if (status === 'confirmed') return 'activity.confirmed'
  if (status === 'failed') return 'activity.failed'
  return 'activity.pending'
}

function statusClass(status: TransactionRecord['status']): string {
  if (status === 'confirmed') return 'text-emerald-400'
  if (status === 'failed') return 'text-red-300'
  return 'text-honey-400'
}

function formatTime(at: number): string {
  if (!at) return ''
  return new Date(at).toLocaleString()
}

export default function ActivityPage() {
  const t = useT()
  const currentWallet = useWalletStore((s) => s.current)
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const current = currentNetworkOf({ networks, currentPk: networkPk })
  const open = useBrowserStore((s) => s.open)
  const [rows, setRows] = useState<TransactionRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (pk = networkPk) => {
    if (!pk) return
    setRows(await transferApi.transactions({ networkPk: pk }))
  }

  const sync = async (pk = networkPk) => {
    if (!pk) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const next = await transferApi.syncTransactions(pk)
      setRows(next)
      setMessage(next.length ? t('activity.synced', { count: next.length }) : t('activity.syncedEmpty'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      await load(pk).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!networkPk) {
      setRows([])
      return
    }
    let alive = true
    setRows([])
    setError(null)
    setMessage(null)
    void (async () => {
      try {
        const cached = await transferApi.transactions({ networkPk })
        if (!alive) return
        setRows(cached)
        setBusy(true)
        try {
          const next = await transferApi.syncTransactions(networkPk)
          if (!alive) return
          setRows(next)
          setMessage(next.length ? t('activity.synced', { count: next.length }) : t('activity.syncedEmpty'))
        } catch (err) {
          if (alive) setError(err instanceof Error ? err.message : String(err))
        } finally {
          if (alive) setBusy(false)
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [networkPk, currentWalletId])

  useEffect(() => {
    return on(IPC_EVENT.transactionUpdated, (payload) => {
      const record = (payload as { record?: TransactionRecord }).record
      if (!record || (networkPk && record.networkPk !== networkPk)) return
      setRows((rows) => {
        const index = rows.findIndex((item) => item.id === record.id || item.txid === record.txid)
        if (index < 0) return [record, ...rows]
        const next = rows.slice()
        next[index] = record
        return next
      })
    })
  }, [networkPk])

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('activity.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {currentWallet ? currentWallet.name : t('home.createWallet')}
            {current ? ` · ${current.networkName}` : ''}
            {' · '}
            {t('activity.hint')}
          </p>
        </div>
        <Button disabled={busy || !networkPk} onClick={() => void sync()}>
          {busy ? t('activity.syncing') : t('activity.sync')}
        </Button>
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title={t('activity.records', { count: rows.length })}>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">
            {t('activity.emptyHint')}
          </p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {rows.map((item) => {
              const url = item.explorerUrl || (current ? txExplorerUrl(current, item.txid) : null)
              return (
                <li key={item.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 w-10 shrink-0 text-xs font-medium ${
                        item.direction === 'receive' ? 'text-emerald-400' : 'text-ink-200'
                      }`}
                    >
                      {item.direction === 'receive' ? t('activity.in') : t('activity.out')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-ink-200">
                          {item.amount} {item.symbol}
                        </span>
                        <span className={`text-[10px] ${statusClass(item.status)}`}>{t(statusLabel(item.status))}</span>
                        {item.blockHeight ? (
                          <span className="text-[10px] text-ink-600">#{item.blockHeight}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-ink-500">
                        {item.direction === 'send' ? t('activity.to') : t('activity.from')}{' '}
                        {shorten(item.direction === 'send' ? item.toAddress : item.fromAddress, 8, 6)}
                        {item.fee ? ` · ${t('activity.fee', { fee: item.fee })}` : ''}
                        {item.createdAt ? ` · ${formatTime(item.createdAt)}` : ''}
                      </p>
                      <div className="mt-1">
                        <AccountAddress label={t('activity.hash')} address={item.txid} explorerUrl={url} />
                      </div>
                    </div>
                    {url ? (
                      <Button
                        variant="ghost"
                        className="shrink-0 px-2 py-1 text-xs"
                        onClick={() => open(url, explorerTabTitle(url))}
                      >
                        {t('activity.detail')}
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
