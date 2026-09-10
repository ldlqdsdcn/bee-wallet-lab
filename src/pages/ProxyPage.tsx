import { useEffect, useState } from 'react'
import type { ProxyListState, ProxyRecord } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { on, proxyApi } from '../lib/bridge'
import { Alert, Button, Card, Field } from '../components/ui'
import { useT } from '../i18n'

function latencyClass(ms: number | null, error: string | null): string {
  if (error) return 'text-red-300'
  if (ms == null) return 'text-ink-600'
  if (ms < 200) return 'text-emerald-400'
  if (ms < 800) return 'text-honey-400'
  return 'text-red-300'
}

function formatLatency(item: ProxyRecord, t: ReturnType<typeof useT>): string {
  if (item.lastError) return t('common.failed')
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
  const t = useT()
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
    ? t('proxy.off')
    : selected
      ? t('proxy.onCurrent', { name: selected.label || displayUrl(selected.url) })
      : t('proxy.onNoSelect')

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('proxy.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">{statusText}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant={state.enabled ? 'primary' : 'ghost'}
            disabled={busy || state.enabled}
            onClick={() => void run(() => proxyApi.setEnabled(true))}
          >
            {t('common.enable')}
          </Button>
          <Button
            variant={!state.enabled ? 'primary' : 'ghost'}
            disabled={busy || !state.enabled}
            onClick={() => void run(() => proxyApi.setEnabled(false))}
          >
            {t('common.disable')}
          </Button>
          <Button variant="ghost" disabled={busy || state.proxies.length === 0} onClick={() => void pingAll()}>
            {pinging === 'all' ? t('common.pinging') : t('common.pingAll')}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title={editingId ? t('proxy.edit') : t('proxy.add')}>
        <div className="space-y-3">
          <Field
            label={t('proxy.url')}
            value={url}
            placeholder="http://127.0.0.1:7890"
            hint={t('proxy.urlHint')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <Field
                label={t('common.optionalMemo')}
                value={label}
                placeholder={t('proxy.labelPh')}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            {editingId ? (
              <>
                <Button disabled={busy || !url.trim()} onClick={() => void saveEdit()}>
                  {t('common.save')}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={cancelEdit}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <Button disabled={busy || !url.trim()} onClick={() => void add()}>
                {t('common.add')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('proxy.list', { count: state.proxies.length })}>
        {state.proxies.length === 0 ? (
          <p className="text-sm text-ink-400">{t('proxy.empty')}</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {state.proxies.map((item) => (
              <li key={item.id} className="flex items-start gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-200">{item.label || displayUrl(item.url)}</span>
                    {item.isSelected ? (
                      <span className="rounded bg-honey-600/20 px-1.5 py-0.5 text-[10px] text-honey-400">{t('common.current')}</span>
                    ) : null}
                    {state.enabled && item.isSelected ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">{t('common.inUse')}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-ink-500">{displayUrl(item.url)}</p>
                  <p className={`mt-1 text-xs ${latencyClass(item.lastLatencyMs, item.lastError)}`}>
                    {t('common.latency', { value: formatLatency(item, t) })}
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
                    {pinging === item.id ? t('common.pinging') : t('common.ping')}
                  </Button>
                  <Button
                    variant={item.isSelected ? 'primary' : 'ghost'}
                    className="px-2 py-1 text-xs"
                    disabled={busy || item.isSelected}
                    onClick={() => void run(() => proxyApi.select(item.id))}
                  >
                    {item.isSelected ? t('common.selected') : t('common.use')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => startEdit(item)}
                  >
                    {t('common.edit')}
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
                    {t('common.delete')}
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
