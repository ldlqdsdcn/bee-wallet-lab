import { useEffect, useState } from 'react'
import type { ProxyListState, ProxyRecord } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { on, proxyApi } from '../lib/bridge'
import { Alert, Button, Card, Field } from '../components/ui'

function latencyClass(ms: number | null, error: string | null): string {
  if (error) return 'text-red-300'
  if (ms == null) return 'text-ink-600'
  if (ms < 200) return 'text-emerald-400'
  if (ms < 800) return 'text-honey-400'
  return 'text-red-300'
}

function formatLatency(item: ProxyRecord): string {
  if (item.lastError) return '失败'
  if (item.lastLatencyMs == null) return '—'
  return `${item.lastLatencyMs} ms`
}

function formatChecked(at: number | null): string {
  if (!at) return ''
  return new Date(at).toLocaleTimeString()
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`)
    if (parsed.username) parsed.password = '***'
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return url
  }
}

export default function ProxyPage() {
  const [state, setState] = useState<ProxyListState>({ enabled: false, proxies: [] })
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pinging, setPinging] = useState<string | null>(null)

  const selected = state.proxies.find((item) => item.isSelected) ?? null

  const applyState = (next: ProxyListState) => {
    setState(next)
  }

  useEffect(() => {
    let alive = true
    void proxyApi
      .list()
      .then((next) => {
        if (alive) setState(next)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return on(IPC_EVENT.proxiesChanged, (payload) => {
      if (payload && typeof payload === 'object' && 'proxies' in payload) {
        setState(payload as ProxyListState)
      } else {
        void proxyApi.list().then(setState).catch(() => undefined)
      }
    })
  }, [])

  const run = async (task: () => Promise<ProxyListState | void>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const next = await task()
      if (next) applyState(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      const next = await proxyApi.add({ url, label })
      setUrl('')
      setLabel('')
      return next
    })

  const startEdit = (item: ProxyRecord) => {
    setEditingId(item.id)
    setUrl(item.url)
    setLabel(item.label ?? '')
    setError(null)
    setMessage(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setUrl('')
    setLabel('')
  }

  const saveEdit = () => {
    if (!editingId) return
    void run(async () => {
      const next = await proxyApi.update({ id: editingId, url, label })
      cancelEdit()
      return next
    })
  }

  const pingOne = async (id: string) => {
    setPinging(id)
    setError(null)
    setMessage(null)
    try {
      const result = await proxyApi.ping(id)
      if (result.ok) setMessage(result.message)
      else setError(result.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPinging(null)
    }
  }

  const pingAll = () =>
    run(async () => {
      setPinging('all')
      try {
        await proxyApi.pingAll()
      } finally {
        setPinging(null)
      }
    })

  const statusText = !state.enabled
    ? '已关闭，第三方接口直连'
    : selected
      ? `已启用 · 当前 ${selected.label || displayUrl(selected.url)}`
      : '已启用，但还没有选择代理'

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">代理</h1>
          <p className="mt-1 text-xs text-ink-500">{statusText}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant={state.enabled ? 'primary' : 'ghost'}
            disabled={busy || state.enabled}
            onClick={() => void run(() => proxyApi.setEnabled(true))}
          >
            启用
          </Button>
          <Button
            variant={!state.enabled ? 'primary' : 'ghost'}
            disabled={busy || !state.enabled}
            onClick={() => void run(() => proxyApi.setEnabled(false))}
          >
            关闭
          </Button>
          <Button variant="ghost" disabled={busy || state.proxies.length === 0} onClick={() => void pingAll()}>
            {pinging === 'all' ? '测速中…' : '全部测速'}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title={editingId ? '编辑代理' : '添加代理'}>
        <div className="space-y-3">
          <Field
            label="代理地址"
            value={url}
            placeholder="http://127.0.0.1:7890"
            hint="支持 http / https / socks5。Clash 常见为 7890 端口。"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <Field
                label="备注（可选）"
                value={label}
                placeholder="例如：Clash"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            {editingId ? (
              <>
                <Button disabled={busy || !url.trim()} onClick={() => void saveEdit()}>
                  保存
                </Button>
                <Button variant="ghost" disabled={busy} onClick={cancelEdit}>
                  取消
                </Button>
              </>
            ) : (
              <Button disabled={busy || !url.trim()} onClick={() => void add()}>
                添加
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card title={`代理列表 · ${state.proxies.length}`}>
        {state.proxies.length === 0 ? (
          <p className="text-sm text-ink-400">还没有代理。添加后点顶部「启用」，行情和节点请求才会走代理。</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {state.proxies.map((item) => (
              <li key={item.id} className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-200">{item.label || displayUrl(item.url)}</span>
                    {item.isSelected ? (
                      <span className="rounded bg-honey-600/20 px-1.5 py-0.5 text-[10px] text-honey-400">当前</span>
                    ) : null}
                    {state.enabled && item.isSelected ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">使用中</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-ink-500">{displayUrl(item.url)}</p>
                  <p className={`mt-1 text-xs ${latencyClass(item.lastLatencyMs, item.lastError)}`}>
                    延迟 {formatLatency(item)}
                    {formatChecked(item.lastCheckedAt) ? ` · ${formatChecked(item.lastCheckedAt)}` : ''}
                    {item.lastError ? ` · ${item.lastError}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    disabled={pinging !== null}
                    onClick={() => void pingOne(item.id)}
                  >
                    {pinging === item.id ? '测速中…' : '测速'}
                  </Button>
                  <Button
                    variant={item.isSelected ? 'primary' : 'ghost'}
                    className="px-2 py-1 text-xs"
                    disabled={busy || item.isSelected}
                    onClick={() => void run(() => proxyApi.select(item.id))}
                  >
                    {item.isSelected ? '已选用' : '使用'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => startEdit(item)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs hover:border-red-500 hover:text-red-400"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const next = await proxyApi.remove(item.id)
                        if (editingId === item.id) cancelEdit()
                        return next
                      })
                    }
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
