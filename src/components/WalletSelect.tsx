import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WalletPickerItem } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { on, walletApi } from '../lib/bridge'
import { useWalletStore } from '../store/walletStore'
import { Button, Field } from './ui'

const PAGE_SIZE = 30
const SEARCH_DEBOUNCE_MS = 250

export function WalletSelect() {
  const navigate = useNavigate()
  const current = useWalletStore((s) => s.current)
  const currentId = useWalletStore((s) => s.currentId)
  const loading = useWalletStore((s) => s.loading)
  const load = useWalletStore((s) => s.load)
  const select = useWalletStore((s) => s.select)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  if (!current && !loading) {
    return (
      <button
        type="button"
        className="w-full rounded-lg border border-dashed border-ink-600 px-3 py-2 text-left text-xs text-ink-500 hover:border-honey-500 hover:text-honey-400"
        onClick={() => navigate('/wallets')}
      >
        还没有钱包，去创建
      </button>
    )
  }

  return (
    <div>
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-600">当前钱包</span>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-left hover:border-honey-500"
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
          {current?.name ?? (loading ? '加载中…' : '选择钱包')}
        </span>
        <span className="text-[10px] text-ink-500">选择</span>
      </button>
      {open ? (
        <WalletPickerDialog
          currentId={currentId}
          onClose={() => setOpen(false)}
          onSelect={async (id) => {
            await select(id)
            setOpen(false)
          }}
          onManage={() => {
            setOpen(false)
            navigate('/wallets')
          }}
        />
      ) : null}
    </div>
  )
}

function WalletPickerDialog({
  currentId,
  onClose,
  onSelect,
  onManage,
}: {
  currentId: string | null
  onClose: () => void
  onSelect: (id: string) => Promise<void>
  onManage: () => void
}) {
  const [name, setName] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<WalletPickerItem[]>([])
  const [total, setTotal] = useState(0)
  const [currencyCode, setCurrencyCode] = useState('CNY')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(name.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [name])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let alive = true
    const fetchPage = async () => {
      setBusy(true)
      setError(null)
      try {
        const result = await walletApi.listPage({ name: debounced, page, pageSize: PAGE_SIZE })
        if (!alive) return
        setItems(result.items)
        setTotal(result.total)
        setCurrencyCode(result.currencyCode)
        if (result.page !== page) setPage(result.page)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setBusy(false)
      }
    }
    void fetchPage()
    const off = on(IPC_EVENT.walletsChanged, () => {
      void fetchPage()
    })
    return () => {
      alive = false
      off()
    }
  }, [debounced, page])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        className="flex max-h-[min(640px,90vh)] w-full max-w-xl flex-col rounded-xl border border-ink-600 bg-ink-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <h2 id="wallet-picker-title" className="text-sm font-semibold text-ink-200">
            选择钱包
          </h2>
          <button type="button" className="text-xs text-ink-500 hover:text-ink-200" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="px-4 pt-3">
          <Field
            label="钱包名"
            placeholder="按名称搜索"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-ink-600">
            共 {total} 个 · 每页 {PAGE_SIZE} 个 · 总余额来自本地缓存
          </p>
        </div>

        {error ? <p className="px-4 pt-2 text-xs text-red-300">{error}</p> : null}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-ink-900 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="pb-2 font-medium">钱包名</th>
                <th className="pb-2 text-right font-medium">总余额</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !busy ? (
                <tr>
                  <td colSpan={2} className="py-8 text-center text-xs text-ink-500">
                    没有匹配的钱包
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const active = item.id === currentId
                  return (
                    <tr key={item.id}>
                      <td colSpan={2} className="p-0">
                        <button
                          type="button"
                          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left ${
                            active ? 'bg-ink-700 text-honey-400' : 'text-ink-200 hover:bg-ink-800'
                          }`}
                          onClick={() => void onSelect(item.id)}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {item.name}
                            {active ? <span className="ml-2 text-[10px] text-ink-500">当前</span> : null}
                          </span>
                          <span className={`shrink-0 tabular-nums text-xs ${active ? 'text-honey-400' : 'text-ink-400'}`}>
                            {item.cachedTotal == null ? '--' : `${item.cachedTotal} ${currencyCode}`}
                          </span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-800 px-4 py-3">
          <Button variant="ghost" className="px-3 py-1 text-xs" onClick={onManage}>
            管理钱包
          </Button>
          <div className="flex items-center gap-2 text-xs text-ink-400">
            <button
              type="button"
              className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
              disabled={page <= 1 || busy}
              onClick={() => setPage((n) => Math.max(1, n - 1))}
            >
              上一页
            </button>
            <span>
              {page} / {pageCount}
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
              disabled={page >= pageCount || busy}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
