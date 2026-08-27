import { useEffect, useMemo, useState } from 'react'
import type { NetworkRecord, TokenRecord, TokenUpsertInput, WalletType } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { catalogApi, on, settingsApi } from '../lib/bridge'
import { Alert, Button, Card, Field } from '../components/ui'
import { NetworkIcon } from '../components/NetworkSelect'

const TYPE_LABEL: Record<WalletType, string> = {
  bitcoin: 'Bitcoin',
  web3: 'EVM',
  tron: 'TRON',
  solana: 'Solana',
}

const TYPE_ORDER: WalletType[] = ['bitcoin', 'web3', 'tron', 'solana']

type TokenForm = {
  name: string
  symbol: string
  decimals: string
  contractAddress: string
  tokenId: string
}

const EMPTY: TokenForm = {
  name: '',
  symbol: '',
  decimals: '',
  contractAddress: '',
  tokenId: '',
}

function networkLabel(network: NetworkRecord): string {
  return network.chainName ? `${network.networkName} (${network.chainName})` : network.networkName
}

function contractHint(network: NetworkRecord | undefined): string {
  if (!network) return '留空表示原生币'
  if (network.walletType === 'bitcoin') return 'Bitcoin 只支持原生币，请留空'
  if (network.walletType === 'tron') return '留空=TRX；合约为 T 开头地址'
  if (network.walletType === 'solana') return '留空=SOL；否则填 mint 地址'
  return '留空=原生币；否则填 0x 合约'
}

function fromRecord(item: TokenRecord): TokenForm {
  return {
    name: item.name ?? '',
    symbol: item.symbol,
    decimals: String(item.decimals),
    contractAddress: item.contractAddress ?? '',
    tokenId: item.tokenId ?? '',
  }
}

export default function TokensPage() {
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [networkPk, setNetworkPk] = useState('')
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [form, setForm] = useState<TokenForm>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current = networks.find((item) => item.id === networkPk)
  const grouped = useMemo(() => {
    const groups: { type: WalletType; items: NetworkRecord[] }[] = []
    for (const type of TYPE_ORDER) {
      const items = networks.filter((item) => item.walletType === type)
      if (items.length) groups.push({ type, items })
    }
    return groups
  }, [networks])

  const patch = (partial: Partial<TokenForm>) => setForm((prev) => ({ ...prev, ...partial }))

  const loadTokens = async (pk: string) => {
    if (!pk) {
      setTokens([])
      return
    }
    setTokens(await catalogApi.tokens(pk))
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

  useEffect(() => {
    if (!networkPk) return
    let alive = true
    setError(null)
    void loadTokens(networkPk)
      .then(() => {
        if (!alive) return
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [networkPk])

  useEffect(() => {
    return on(IPC_EVENT.catalogUpdated, () => {
      void (async () => {
        try {
          const list = await catalogApi.networks()
          setNetworks(list)
          setNetworkPk((pk) => (list.some((item) => item.id === pk) ? pk : list[0]?.id || ''))
          const pk = list.some((item) => item.id === networkPk) ? networkPk : list[0]?.id || ''
          if (pk) await loadTokens(pk)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      })()
    })
  }, [networkPk])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await task()
      await loadTokens(networkPk)
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

  const save = () =>
    run(async () => {
      const decimals = form.decimals.trim() === '' ? undefined : Number(form.decimals)
      if (decimals != null && !Number.isFinite(decimals)) throw new Error('精度无效')
      const input: TokenUpsertInput = {
        id: editingId ?? undefined,
        networkPk,
        name: form.name,
        symbol: form.symbol,
        decimals,
        contractAddress: form.contractAddress,
        tokenId: form.tokenId,
      }
      await catalogApi.upsertToken(input)
      setMessage(editingId ? '代币已保存' : '代币已添加')
      resetForm()
    })

  const startEdit = (item: TokenRecord) => {
    setEditingId(item.id)
    setForm(fromRecord(item))
    setError(null)
    setMessage(null)
  }

  const restore = () =>
    run(async () => {
      const result = await catalogApi.sync(true)
      setMessage(`已恢复内置目录：${result.networks} 个网络 / ${result.tokens} 个代币`)
      const list = await catalogApi.networks()
      setNetworks(list)
    })

  return (
    <div className="mx-auto flex max-w-6xl gap-5">
      <aside className="w-60 shrink-0 rounded-xl border border-ink-700 bg-ink-800/60">
        <div className="border-b border-ink-700 px-4 py-3">
          <h1 className="text-sm font-semibold text-ink-200">网络</h1>
          <p className="mt-1 text-[11px] text-ink-600">每个网络单独维护代币列表</p>
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
                    onClick={() => {
                      setNetworkPk(item.id)
                      resetForm()
                    }}
                  >
                    <NetworkIcon src={item.icon} name={item.networkName} size={18} />
                    <span className="min-w-0 flex-1 truncate">{networkLabel(item)}</span>
                    {item.source === 'custom' ? (
                      <span className="shrink-0 text-[10px] text-ink-600">自建</span>
                    ) : item.networkScope === 'testnet' ? (
                      <span className="shrink-0 text-[10px] text-ink-600">测试</span>
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
            <h1 className="text-lg font-semibold text-ink-200">代币维护</h1>
            <p className="mt-1 text-xs text-ink-500">
              {current ? networkLabel(current) : '选择网络'}
              {' · 合约留空表示原生币 · 恢复内置不会删自定义代币'}
            </p>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => void restore()}>
            恢复内置
          </Button>
        </div>

        {error ? <Alert>{error}</Alert> : null}
        {message ? <p className="text-xs text-honey-400">{message}</p> : null}

        <Card title={editingId ? '编辑代币' : '添加代币'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="名称"
              value={form.name}
              placeholder="USD Coin"
              onChange={(e) => patch({ name: e.target.value })}
            />
            <Field
              label="符号"
              value={form.symbol}
              placeholder="USDC"
              onChange={(e) => patch({ symbol: e.target.value })}
            />
            <Field
              label="精度"
              value={form.decimals}
              placeholder={current?.walletType === 'solana' ? '9' : '18'}
              hint="留空则按链默认：BTC 8 / EVM 18 / TRX 6 / SOL 9"
              onChange={(e) => patch({ decimals: e.target.value })}
            />
            <Field
              label="CoinGecko id（可选）"
              value={form.tokenId}
              placeholder="usd-coin"
              onChange={(e) => patch({ tokenId: e.target.value })}
            />
            <div className="sm:col-span-2">
              <Field
                label="合约地址"
                value={form.contractAddress}
                placeholder={contractHint(current)}
                hint={contractHint(current)}
                disabled={current?.walletType === 'bitcoin'}
                onChange={(e) => patch({ contractAddress: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button disabled={busy || !networkPk || !form.symbol.trim()} onClick={() => void save()}>
              {editingId ? '保存' : '添加'}
            </Button>
            {editingId ? (
              <Button variant="ghost" disabled={busy} onClick={resetForm}>
                取消
              </Button>
            ) : null}
          </div>
        </Card>

        <Card title={`代币列表 · ${tokens.length}`}>
          {tokens.length === 0 ? (
            <p className="text-sm text-ink-400">这个网络还没有代币。添加网络时会自动写入原生币。</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {tokens.map((item) => (
                <li key={item.id} className="flex items-start gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink-200">
                        {item.symbol}
                        {item.name && item.name !== item.symbol ? ` · ${item.name}` : ''}
                      </span>
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-ink-400">
                        {item.source === 'builtin' ? '内置' : '自建'}
                      </span>
                      {!item.isToken ? (
                        <span className="rounded bg-honey-600/20 px-1.5 py-0.5 text-[10px] text-honey-400">原生</span>
                      ) : item.tokenStandard ? (
                        <span className="text-[10px] text-ink-600">{item.tokenStandard}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-500">
                      精度 {item.decimals}
                      {item.contractAddress ? ` · ${item.contractAddress}` : ''}
                      {item.tokenId ? ` · ${item.tokenId}` : ''}
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
                        if (!window.confirm(`确定删除 ${item.symbol}？`)) return
                        void run(async () => {
                          await catalogApi.removeToken(item.id)
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
          )}
        </Card>
      </div>
    </div>
  )
}
