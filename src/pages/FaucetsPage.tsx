import { useEffect, useMemo, useState } from 'react'
import type { FaucetRecord, NetworkRecord, WalletType } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { catalogApi, faucetApi, on, settingsApi } from '../lib/bridge'
import { Alert, Button, Card, Field } from '../components/ui'
import { NetworkIcon } from '../components/NetworkSelect'
import { explorerTabTitle } from '../lib/explorer'
import { useBrowserStore } from '../store/browserStore'

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

export default function FaucetsPage() {
  const open = useBrowserStore((s) => s.open)
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [networkPk, setNetworkPk] = useState('')
  const [rows, setRows] = useState<FaucetRecord[]>([])
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const testnets = useMemo(
    () => networks.filter((item) => item.networkScope === 'testnet'),
    [networks],
  )
  const current = testnets.find((item) => item.id === networkPk)

  const grouped = useMemo(() => {
    const groups: { type: WalletType; items: NetworkRecord[] }[] = []
    for (const type of TYPE_ORDER) {
      const items = testnets.filter((item) => item.walletType === type)
      if (items.length) groups.push({ type, items })
    }
    return groups
  }, [testnets])

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
        const tests = list.filter((item) => item.networkScope === 'testnet')
        setNetworks(list)
        setNetworkPk((pk) => {
          if (pk && tests.some((item) => item.id === pk)) return pk
          if (settings.defaultNetworkPk && tests.some((item) => item.id === settings.defaultNetworkPk)) {
            return settings.defaultNetworkPk
          }
          return tests[0]?.id || ''
        })
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
    setRows(await faucetApi.list(pk))
  }

  useEffect(() => {
    if (!networkPk) {
      setRows([])
      return
    }
    let alive = true
    setError(null)
    void faucetApi
      .list(networkPk)
      .then((list) => {
        if (alive) setRows(list)
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
    return on(IPC_EVENT.faucetsChanged, () => {
      void faucetApi
        .list(networkPk)
        .then(setRows)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    })
  }, [networkPk])

  const resetForm = () => {
    setUrl('')
    setLabel('')
    setEditingId(null)
  }

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

  const save = () =>
    run(async () => {
      if (!networkPk) return
      await faucetApi.upsert({
        id: editingId ?? undefined,
        networkPk,
        url,
        label,
      })
      resetForm()
    })

  const edit = (item: FaucetRecord) => {
    setEditingId(item.id)
    setUrl(item.url)
    setLabel(item.label ?? '')
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-5">
      <aside className="w-60 shrink-0 rounded-xl border border-ink-700 bg-ink-800/60">
        <div className="border-b border-ink-700 px-4 py-3">
          <h1 className="text-sm font-semibold text-ink-200">测试网</h1>
          <p className="mt-1 text-[11px] text-ink-600">主网没有水龙头</p>
        </div>
        <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-2">
          {grouped.length === 0 ? (
            <p className="px-2 py-3 text-xs text-ink-500">还没有测试网。到「网络维护」添加 Sepolia / Nile / Devnet 等。</p>
          ) : (
            grouped.map((group) => (
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
                      onClick={() => {
                        resetForm()
                        setNetworkPk(item.id)
                      }}
                    >
                      <NetworkIcon src={item.icon} name={item.networkName} size={18} />
                      <span className="min-w-0 flex-1 truncate">{networkLabel(item)}</span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-ink-200">水龙头</h1>
            <p className="mt-1 text-xs text-ink-500">
              {current ? networkLabel(current) : '选择测试网'}
              {' · 本版手动维护，后续可从目录站同步内置项'}
            </p>
          </div>
          <Button
            variant="ghost"
            disabled={busy || !networkPk}
            onClick={() => void run(() => faucetApi.restore(networkPk).then(() => undefined))}
          >
            恢复内置
          </Button>
        </div>

        {error ? <Alert>{error}</Alert> : null}

        <Card title={editingId ? '编辑水龙头' : '添加水龙头'}>
          <div className="grid grid-cols-[1fr_160px_auto] items-end gap-3">
            <Field
              label="网站地址"
              value={url}
              placeholder="https://faucet.example.com"
              hint="http 或 https。点列表里的「打开」会在应用内浏览器打开。"
              onChange={(e) => setUrl(e.target.value)}
            />
            <Field label="备注（可选）" value={label} placeholder="例如：Alchemy" onChange={(e) => setLabel(e.target.value)} />
            <div className="flex gap-2">
              {editingId ? (
                <Button variant="ghost" disabled={busy} onClick={resetForm}>
                  取消
                </Button>
              ) : null}
              <Button disabled={busy || !url.trim() || !networkPk} onClick={() => void save()}>
                {editingId ? '保存' : '添加'}
              </Button>
            </div>
          </div>
        </Card>

        <Card title={`水龙头 · ${rows.length}`}>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-400">
              这个测试网还没有水龙头。添加一条，或点「恢复内置」写入常见水龙头。
            </p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {rows.map((item) => (
                <li key={item.id} className="flex items-start gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-200">{item.label || item.url}</span>
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-ink-400">
                        {item.source === 'builtin' ? '内置' : '自建'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-500">{item.url}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => open(item.url, item.label || explorerTabTitle(item.url))}
                    >
                      打开
                    </Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => edit(item)}>
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs hover:border-red-500 hover:text-red-400"
                      disabled={busy}
                      onClick={() => void run(() => faucetApi.remove(item.id).then(() => undefined))}
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
    </div>
  )
}
