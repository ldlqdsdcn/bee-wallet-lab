import { useEffect, useMemo, useState } from 'react'
import type { NetworkRecord, RpcNodeRecord, WalletType } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { catalogApi, on, rpcApi, settingsApi } from '../lib/bridge'
import { Alert, Button, Card, Field } from '../components/ui'
import { NetworkIcon } from '../components/NetworkSelect'
import { useT } from '../i18n'

const TYPE_LABEL: Record<WalletType, string> = {
  bitcoin: 'Bitcoin',
  web3: 'EVM',
  tron: 'TRON',
  solana: 'Solana',
}

const TYPE_ORDER: WalletType[] = ['bitcoin', 'web3', 'tron', 'solana']

function networkLabel(network: NetworkRecord): string {
  return network.chainName ? `${network.networkName} (${network.chainName})` : network.networkName
}

function urlHint(network: NetworkRecord | undefined, t: ReturnType<typeof useT>): string {
  if (!network) return t('nodes.hintGeneric')
  if (network.walletType === 'bitcoin') return t('nodes.hintBtc')
  if (network.walletType === 'tron') return t('nodes.hintTron')
  if (network.walletType === 'solana') return t('nodes.hintSol')
  return t('nodes.hintEvm')
}

function latencyClass(ms: number | null, error: string | null): string {
  if (error) return 'text-red-300'
  if (ms == null) return 'text-ink-600'
  if (ms < 200) return 'text-emerald-400'
  if (ms < 800) return 'text-honey-400'
  return 'text-red-300'
}

function formatLatency(node: RpcNodeRecord, t: ReturnType<typeof useT>): string {
  if (node.lastError) return t('common.failed')
  if (node.lastLatencyMs == null) return '—'
  return `${node.lastLatencyMs} ms`
}

function formatChecked(at: number | null): string {
  if (!at) return ''
  return new Date(at).toLocaleTimeString()
}

export default function RpcNodesPage() {
  const t = useT()
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [networkPk, setNetworkPk] = useState('')
  const [nodes, setNodes] = useState<RpcNodeRecord[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pinging, setPinging] = useState<string | null>(null)

  const current = networks.find((item) => item.id === networkPk)
  const selected = nodes.find((item) => item.isSelected) ?? null

  const grouped = useMemo(() => {
    const sorted = [...networks].sort((a, b) => {
      const type = TYPE_ORDER.indexOf(a.walletType) - TYPE_ORDER.indexOf(b.walletType)
      if (type !== 0) return type
      if (a.networkScope !== b.networkScope) return a.networkScope === 'mainnet' ? -1 : 1
      return networkLabel(a).localeCompare(networkLabel(b), 'zh')
    })
    const groups: { type: WalletType; items: NetworkRecord[] }[] = []
    for (const type of TYPE_ORDER) {
      const items = sorted.filter((item) => item.walletType === type)
      if (items.length) groups.push({ type, items })
    }
    return groups
  }, [networks])

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

  const reload = async (pk = networkPk) => {
    if (!pk) return
    setNodes(await rpcApi.list(pk))
  }

  useEffect(() => {
    if (!networkPk) return
    let alive = true
    setError(null)
    void rpcApi
      .list(networkPk)
      .then((list) => {
        if (alive) setNodes(list)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [networkPk])

  useEffect(() => {
    if (!networkPk) return
    return on(IPC_EVENT.rpcNodesChanged, () => {
      void rpcApi
        .list(networkPk)
        .then(setNodes)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    })
  }, [networkPk])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    run(async () => {
      await rpcApi.add({ networkPk, url, label })
      setUrl('')
      setLabel('')
    })

  const pingOne = async (id: string) => {
    setPinging(id)
    setError(null)
    try {
      const result = await rpcApi.ping(id)
      if (!result.ok) setError(result.error)
      await reload()
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
        await rpcApi.pingAll(networkPk)
      } finally {
        setPinging(null)
      }
    })

  return (
    <div className="mx-auto flex max-w-6xl gap-5">
      <aside className="w-60 shrink-0 rounded-xl border border-ink-700 bg-ink-800/60">
        <div className="border-b border-ink-700 px-4 py-3">
          <h1 className="text-sm font-semibold text-ink-200">{t('nodes.sidebar')}</h1>
          <p className="mt-1 text-[11px] text-ink-600">{t('nodes.sidebarHint')}</p>
        </div>
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-2">
          {grouped.map((group) => (
            <div key={group.type} className="mb-3">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-ink-600">{TYPE_LABEL[group.type]}</p>
              {group.items.map((item) => {
                const active = item.id === networkPk
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${
                      active ? 'bg-ink-700 text-honey-400' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                    }`}
                    onClick={() => setNetworkPk(item.id)}
                  >
                    <NetworkIcon src={item.icon} name={item.networkName} size={18} />
                    <span className="min-w-0 flex-1 truncate">{networkLabel(item)}</span>
                    {item.networkScope === 'testnet' ? (
                      <span className="shrink-0 text-[10px] text-ink-600">{t('common.testShort')}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-ink-200">{t('nodes.title')}</h1>
            <p className="mt-1 text-xs text-ink-500">
              {current ? networkLabel(current) : t('network.pick')}
              {selected ? ` · ${t('nodes.manual')}` : ` · ${t('nodes.auto')}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {selected ? (
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => rpcApi.useAuto(networkPk).then(() => undefined))}>
                {t('nodes.useAuto')}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy || !networkPk} onClick={() => void pingAll()}>
              {pinging === 'all' ? t('common.pinging') : t('common.pingAll')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !networkPk}
              onClick={() => void run(() => rpcApi.restore(networkPk).then(() => undefined))}
            >
              {t('common.restore')}
            </Button>
          </div>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        <Card title={t('nodes.add')}>
          <div className="grid grid-cols-[1fr_160px_auto] items-end gap-3">
            <Field
              label={t('nodes.url')}
              value={url}
              placeholder={urlHint(current, t)}
              hint={urlHint(current, t)}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Field label={t('common.optionalMemo')} value={label} placeholder={t('nodes.labelPh')} onChange={(e) => setLabel(e.target.value)} />
            <Button disabled={busy || !url.trim() || !networkPk} onClick={() => void add()}>
              {t('common.add')}
            </Button>
          </div>
        </Card>

        <Card title={t('nodes.list', { count: nodes.length })}>
          {nodes.length === 0 ? (
            <p className="text-sm text-ink-400">{t('nodes.empty')}</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {nodes.map((node) => (
                <li key={node.id} className="flex items-start gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-200">{node.label || node.url}</span>
                      {node.isSelected ? (
                        <span className="rounded bg-honey-600/20 px-1.5 py-0.5 text-[10px] text-honey-400">{t('common.current')}</span>
                      ) : null}
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-ink-400">
                        {node.source === 'builtin' ? t('common.builtin') : t('common.customSource')}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-500">{node.url}</p>
                    <p className={`mt-1 text-xs ${latencyClass(node.lastLatencyMs, node.lastError)}`}>
                      {t('common.latency', { value: formatLatency(node, t) })}
                      {formatChecked(node.lastCheckedAt) ? ` · ${formatChecked(node.lastCheckedAt)}` : ''}
                      {node.lastError ? ` · ${node.lastError}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      disabled={pinging !== null}
                      onClick={() => void pingOne(node.id)}
                    >
                      {pinging === node.id ? t('common.pinging') : t('common.ping')}
                    </Button>
                    <Button
                      variant={node.isSelected ? 'primary' : 'ghost'}
                      className="px-2 py-1 text-xs"
                      disabled={busy || node.isSelected}
                      onClick={() => void run(() => rpcApi.select(node.id).then(() => undefined))}
                    >
                      {node.isSelected ? t('common.inUse') : t('common.use')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs hover:border-red-500 hover:text-red-400"
                      disabled={busy}
                      onClick={() => void run(() => rpcApi.remove(node.id).then(() => undefined))}
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
    </div>
  )
}
