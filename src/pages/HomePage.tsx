import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AssetEntry, NetworkRecord, PortfolioSnapshot } from '@shared/types'
import { catalogApi, portfolioApi, settingsApi } from '../lib/bridge'
import { Alert, Button, Card } from '../components/ui'
import { AccountAddress } from '../components/AccountAddress'
import { NetworkSelect } from '../components/NetworkSelect'
import { addressExplorerUrl } from '../lib/explorer'
import { bitcoinAddressLabel, fromMinor } from '../lib/format'
import { useWalletStore } from '../store/walletStore'

export default function HomePage() {
  const navigate = useNavigate()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const currentWallet = useWalletStore((s) => s.current)
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [networkPk, setNetworkPk] = useState('')
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    setSnapshot(null)
    setError(null)
    void portfolioApi
      .snapshot(networkPk)
      .then((next) => {
        if (alive) setSnapshot(next)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [currentWalletId, networkPk])

  const refresh = async (pk = networkPk) => {
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await portfolioApi.refresh(pk))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const current = networks.find((item) => item.id === networkPk)
  const isBitcoin = current?.walletType === 'bitcoin'
  const accountEntries = useMemo(() => uniqueAccountEntries(snapshot?.entries ?? []), [snapshot])

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">资产总览</h1>
          <p className="mt-1 text-xs text-ink-500">
            {currentWallet ? currentWallet.name : '请先创建钱包'}
            {current ? ` · ${current.networkName}` : ''}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <NetworkSelect
            label="网络"
            networks={networks}
            value={networkPk}
            onChange={(id) => {
              setNetworkPk(id)
              void refresh(id)
            }}
          />
          <Button disabled={busy || !networkPk} onClick={() => void refresh()}>
            {busy ? '刷新中…' : '刷新'}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>
      {snapshot?.offline ? (
        <p className="rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2 text-xs text-honey-400">
          节点暂时不可达，正在展示本地缓存余额
        </p>
      ) : null}
      {snapshot?.priceError ? (
        <p className="rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2 text-xs text-honey-400">
          {snapshot.priceError}
        </p>
      ) : null}

      <Card>
        <p className="text-xs text-ink-500">总资产（{snapshot?.currencyCode ?? 'CNY'}）</p>
        <p className="mt-1 text-3xl font-semibold text-ink-100">
          {snapshot?.totalCurrency ?? '--'}
        </p>
        {accountEntries.length > 0 ? (
          <div className="mt-4 space-y-2 border-t border-ink-700 pt-3">
            <p className="text-xs text-ink-500">账户地址</p>
            {accountEntries.map((entry) => (
              <AccountAddress
                key={entry.address}
                address={entry.address!}
                label={isBitcoin ? bitcoinAddressLabel(entry.addressType) : undefined}
                explorerUrl={current ? addressExplorerUrl(current, entry.address!) : null}
              />
            ))}
          </div>
        ) : snapshot ? (
          <p className="mt-3 text-xs text-ink-500">未派生对应账户</p>
        ) : null}
      </Card>

      <Card title="代币">
        {!snapshot || snapshot.entries.length === 0 ? (
          <p className="text-sm text-ink-400">暂无资产。请先创建钱包并同步网络目录。</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {snapshot.entries.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left hover:bg-ink-800/40"
                  onClick={() =>
                    navigate('/transfer', {
                      state: {
                        networkPk: entry.networkPk,
                        tokenPk: entry.tokenPk,
                        accountId: entry.accountId,
                      },
                    })
                  }
                >
                  {entry.iconUrl ? (
                    <img src={entry.iconUrl} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-xs text-honey-400">
                      {entry.symbol.slice(0, 3)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-200">{entry.name}</span>
                      {entry.addressType ? (
                        <span className="text-[10px] uppercase text-ink-500">
                          {bitcoinAddressLabel(entry.addressType)}
                        </span>
                      ) : null}
                      {entry.stale ? <span className="text-[10px] text-honey-400">缓存</span> : null}
                    </div>
                    {!entry.address ? (
                      <p className="truncate text-[11px] text-ink-500">未派生对应账户</p>
                    ) : entry.error ? (
                      <p className="truncate text-[11px] text-ink-500">{entry.error}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-ink-200">
                      {fromMinor(entry.balance, entry.decimals)} {entry.symbol}
                    </p>
                    <p className="text-[11px] text-ink-500">
                      {entry.currencyBalance ?? '--'} {snapshot.currencyCode}
                    </p>
                  </div>
                </button>
                {isBitcoin && entry.address ? (
                  <div className="pb-3 pl-11">
                    <AccountAddress
                      address={entry.address}
                      explorerUrl={current ? addressExplorerUrl(current, entry.address) : null}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function uniqueAccountEntries(entries: AssetEntry[]): AssetEntry[] {
  const seen = new Set<string>()
  const rows: AssetEntry[] = []
  for (const entry of entries) {
    if (!entry.address || seen.has(entry.address)) continue
    seen.add(entry.address)
    rows.push(entry)
  }
  return rows
}
