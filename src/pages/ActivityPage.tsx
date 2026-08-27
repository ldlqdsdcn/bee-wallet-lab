import { useEffect, useState } from 'react'
import type { NetworkRecord, TransactionRecord } from '@shared/types'
import { catalogApi, settingsApi, transferApi } from '../lib/bridge'
import { Alert, Button, Card } from '../components/ui'
import { NetworkSelect } from '../components/NetworkSelect'
import { AccountAddress } from '../components/AccountAddress'
import { explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'

function statusLabel(status: TransactionRecord['status']): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'failed') return '失败'
  return '待确认'
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
  const currentWallet = useWalletStore((s) => s.current)
  const currentWalletId = useWalletStore((s) => s.currentId)
  const open = useBrowserStore((s) => s.open)
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [networkPk, setNetworkPk] = useState('')
  const [rows, setRows] = useState<TransactionRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current = networks.find((item) => item.id === networkPk)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        let list = await catalogApi.networks()
        if (!alive) return
        if (list.length === 0) {
          await catalogApi.sync()
          list = await catalogApi.networks()
          if (!alive) return
        }
        const settings = await settingsApi.get()
        if (!alive) return
        setNetworks(list)
        setNetworkPk((pk) => pk || settings.defaultNetworkPk || list[0]?.id || '')
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

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
      setMessage(next.length ? `已同步 ${next.length} 条` : '没有拉到交易。确认当前钱包已派生该网络账户')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      await load(pk).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!networkPk) return
    let alive = true
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
          setMessage(next.length ? `已同步 ${next.length} 条` : '没有拉到交易。确认当前钱包已派生该网络账户')
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

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">交易记录</h1>
          <p className="mt-1 text-xs text-ink-500">
            {currentWallet ? currentWallet.name : '请先创建钱包'}
            {current ? ` · ${current.networkName}` : ''}
            {' · 从 Esplora / Blockscout / TronGrid / Solana RPC 同步'}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <NetworkSelect
            label="网络"
            networks={networks}
            value={networkPk}
            onChange={(id) => setNetworkPk(id)}
          />
          <Button disabled={busy || !networkPk} onClick={() => void sync()}>
            {busy ? '同步中…' : '同步'}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title={`记录 · ${rows.length}`}>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">
            还没有交易。点「同步」从链上索引拉取当前钱包在该网络的记录。
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
                      {item.direction === 'receive' ? '收入' : '支出'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-ink-200">
                          {item.amount} {item.symbol}
                        </span>
                        <span className={`text-[10px] ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                        {item.blockHeight ? (
                          <span className="text-[10px] text-ink-600">#{item.blockHeight}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-ink-500">
                        {item.direction === 'send' ? '到' : '从'}{' '}
                        {shorten(item.direction === 'send' ? item.toAddress : item.fromAddress, 8, 6)}
                        {item.fee ? ` · 手续费 ${item.fee}` : ''}
                        {item.createdAt ? ` · ${formatTime(item.createdAt)}` : ''}
                      </p>
                      <div className="mt-1">
                        <AccountAddress label="哈希" address={item.txid} explorerUrl={url} />
                      </div>
                    </div>
                    {url ? (
                      <Button
                        variant="ghost"
                        className="shrink-0 px-2 py-1 text-xs"
                        onClick={() => open(url, explorerTabTitle(url))}
                      >
                        详情
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
