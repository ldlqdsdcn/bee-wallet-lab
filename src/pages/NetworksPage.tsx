import { useEffect, useMemo, useState } from 'react'
import type { NetworkRecord, NetworkScope, NetworkUpsertInput, WalletType } from '@shared/types'
import { featuredNetworkPresets, matchNetworkPreset } from '@shared/networkPresets'
import { IPC_EVENT } from '@shared/ipc'
import { catalogApi, on } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { NetworkIcon } from '../components/NetworkSelect'

const TYPE_LABEL: Record<WalletType, string> = {
  bitcoin: 'Bitcoin',
  web3: 'EVM',
  tron: 'TRON',
  solana: 'Solana',
}

const TYPE_ORDER: WalletType[] = ['bitcoin', 'web3', 'tron', 'solana']

const EMPTY: NetworkUpsertInput = {
  networkName: '',
  walletType: 'web3',
  networkScope: 'mainnet',
  chainId: '',
  chainName: '',
  rpcUrl: '',
  browser: '',
  coinId: '',
  coinEasy: '',
  remark: '',
}

function chainHint(type: WalletType): string {
  if (type === 'bitcoin') return '例如 Mainnet / Testnet'
  if (type === 'tron') return '例如 728126428（主网）'
  if (type === 'solana') return '主网 101，Devnet 103'
  return '十进制 chainId，例如 1 / 56 / 42161'
}

function networkLabel(network: NetworkRecord): string {
  return network.chainName ? `${network.networkName} (${network.chainName})` : network.networkName
}

function fromRecord(item: NetworkRecord): NetworkUpsertInput {
  return {
    id: item.id,
    networkName: item.networkName,
    walletType: item.walletType,
    networkScope: item.networkScope,
    chainId: item.chainId,
    chainName: item.chainName,
    rpcUrl: item.rpcUrl ?? '',
    browser: item.browser ?? '',
    coinId: item.coinId ?? '',
    coinEasy: item.coinEasy ?? '',
    remark: item.remark ?? '',
  }
}

export default function NetworksPage() {
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [form, setForm] = useState<NetworkUpsertInput>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const grouped = useMemo(() => {
    const groups: { type: WalletType; items: NetworkRecord[] }[] = []
    for (const type of TYPE_ORDER) {
      const items = networks.filter((item) => item.walletType === type)
      if (items.length) groups.push({ type, items })
    }
    return groups
  }, [networks])

  const patch = (partial: Partial<NetworkUpsertInput>) => setForm((prev) => ({ ...prev, ...partial }))

  const reload = async () => {
    setNetworks(await catalogApi.networks())
  }

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
        setNetworks(list)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return on(IPC_EVENT.catalogUpdated, () => {
      void catalogApi
        .networks()
        .then(setNetworks)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    })
  }, [])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await task()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY)
  }

  const applyLookup = async (query: { q?: string; chainId?: string }, typedName?: string) => {
    const result = await catalogApi.lookup(query)
    if (!result.supported) {
      setError(result.hint ?? '暂不支持该网络')
      setMessage(null)
      if (typedName !== undefined) patch({ networkName: typedName })
      return
    }
    if (!result.network) return
    setError(null)
    setForm((prev) => ({
      ...prev,
      ...result.network,
      id: prev.id,
      remark: prev.remark,
      networkName: typedName || result.network?.networkName || prev.networkName,
      coinEasy: result.network?.coinEasy || result.native?.symbol || prev.coinEasy,
      coinId: result.network?.coinId || result.native?.tokenId || prev.coinId,
    }))
    const hot = result.tokens.map((item) => item.symbol).join(' / ')
    const origin = result.source === 'remote' ? '目录站' : '本地预设'
    setMessage(
      `${origin}：${result.network.networkName}，主币 ${result.native?.symbol ?? result.network.coinEasy}${
        hot ? `，热门 ${hot}` : ''
      }`,
    )
  }

  const save = () =>
    run(async () => {
      await catalogApi.upsertNetwork({
        ...form,
        id: editingId ?? undefined,
      })
      setMessage(editingId ? '网络已保存' : '网络已添加，并写入了主币和热门代币')
      resetForm()
    })

  const startEdit = (item: NetworkRecord) => {
    setEditingId(item.id)
    setForm(fromRecord(item))
    setError(null)
    setMessage(null)
  }

  const restore = () =>
    run(async () => {
      const result = await catalogApi.sync(true)
      setMessage(`已恢复内置目录：${result.networks} 个网络 / ${result.tokens} 个代币`)
    })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">网络维护</h1>
          <p className="mt-1 text-xs text-ink-500">
            点常用链或输入 chainId / 名称，会先问目录站（设置了地址时），否则用本地预设，自动带上主币和热门代币。
          </p>
        </div>
        <Button variant="ghost" disabled={busy} onClick={() => void restore()}>
          恢复内置
        </Button>
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title={editingId ? '编辑网络' : '添加网络'}>
        {!editingId ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {featuredNetworkPresets().map((preset) => (
              <button
                key={preset.networkName}
                type="button"
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  preset.supported
                    ? 'border-ink-600 text-ink-300 hover:border-honey-500 hover:text-honey-400'
                    : 'border-ink-800 text-ink-600'
                }`}
                onClick={() => {
                  void applyLookup({ q: preset.aliases[0] }).catch((err) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
                }}
              >
                {preset.networkName}
                {preset.supported ? ` · ${preset.coinEasy}` : ' · 未支持'}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="名称"
            value={form.networkName}
            placeholder="例如 Base / Xone / Polygon"
            hint="输入完整名称或 chainId 会自动匹配主币"
            onChange={(e) => {
              const networkName = e.target.value
              patch({ networkName })
              const preset = matchNetworkPreset(networkName)
              if (!preset) return
              void applyLookup({ q: networkName }, networkName).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }}
            onBlur={(e) => {
              const networkName = e.target.value.trim()
              if (!networkName || matchNetworkPreset(networkName)) return
              void applyLookup({ q: networkName, chainId: form.chainId }, networkName).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }}
          />
          <Field
            label="原生符号"
            value={form.coinEasy ?? ''}
            placeholder="ETH / XOC / POL"
            hint="主币符号。不填时按 chainId 匹配，EVM 未知链才默认 ETH"
            onChange={(e) => patch({ coinEasy: e.target.value })}
          />
          <Select
            label="链类型"
            value={form.walletType}
            onChange={(e) => patch({ walletType: e.target.value as WalletType, chainId: '' })}
          >
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
          <Select
            label="网络环境"
            value={form.networkScope}
            onChange={(e) => patch({ networkScope: e.target.value as NetworkScope })}
          >
            <option value="mainnet">主网</option>
            <option value="testnet">测试网</option>
          </Select>
          <Field
            label="chainId"
            value={form.chainId}
            placeholder={chainHint(form.walletType)}
            hint={chainHint(form.walletType)}
            onChange={(e) => {
              const chainId = e.target.value
              patch({ chainId })
              if (!matchNetworkPreset(chainId)) return
              void applyLookup({ chainId, q: form.networkName }).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }}
            onBlur={(e) => {
              const chainId = e.target.value.trim()
              if (!chainId || matchNetworkPreset(chainId)) return
              void applyLookup({ chainId, q: form.networkName }).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }}
          />
          <Field
            label="链名称（可选）"
            value={form.chainName ?? ''}
            placeholder="Mainnet"
            onChange={(e) => patch({ chainName: e.target.value })}
          />
          <Field
            label="RPC 地址（可选）"
            value={form.rpcUrl ?? ''}
            placeholder="https://"
            onChange={(e) => patch({ rpcUrl: e.target.value })}
          />
          <Field
            label="浏览器（可选）"
            value={form.browser ?? ''}
            placeholder="https://..."
            onChange={(e) => patch({ browser: e.target.value })}
          />
          <Field
            label="CoinGecko id（可选）"
            value={form.coinId ?? ''}
            placeholder="ethereum"
            hint="给原生币拉行情用，例如 ethereum、solana"
            onChange={(e) => patch({ coinId: e.target.value })}
          />
          <Field
            label="备注（可选）"
            value={form.remark ?? ''}
            onChange={(e) => patch({ remark: e.target.value })}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button disabled={busy || !form.networkName.trim() || !form.chainId.trim()} onClick={() => void save()}>
            {editingId ? '保存' : '添加'}
          </Button>
          {editingId ? (
            <Button variant="ghost" disabled={busy} onClick={resetForm}>
              取消
            </Button>
          ) : null}
        </div>
      </Card>

      <Card title={`网络列表 · ${networks.length}`}>
        {networks.length === 0 ? (
          <p className="text-sm text-ink-400">还没有网络。点「恢复内置」装入打包目录，或在上方添加自定义链。</p>
        ) : (
          grouped.map((group) => (
            <div key={group.type} className="mb-4 last:mb-0">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-600">{TYPE_LABEL[group.type]}</p>
              <ul className="divide-y divide-ink-700">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-start gap-4 py-3">
                    <NetworkIcon src={item.icon} name={item.networkName} size={22} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink-200">{networkLabel(item)}</span>
                        <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-ink-400">
                          {item.source === 'builtin' ? '内置' : '自建'}
                        </span>
                        {item.networkScope === 'testnet' ? (
                          <span className="text-[10px] text-ink-600">测试</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-ink-500">
                        {item.coinEasy || '—'} · chainId {item.chainId}
                        {item.rpcUrl ? ` · ${item.rpcUrl}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={busy} onClick={() => startEdit(item)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs hover:border-red-500 hover:text-red-400"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`删除「${item.networkName}」会同时去掉该网络的代币和节点。确定？`)) return
                          void run(async () => {
                            await catalogApi.removeNetwork(item.id)
                            if (editingId === item.id) resetForm()
                          })
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
