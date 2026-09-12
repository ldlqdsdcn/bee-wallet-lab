import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AssetEntry, FaucetRecord, PortfolioSnapshot } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { faucetApi, on, portfolioApi } from '../lib/bridge'
import { Alert, Button, Card } from '../components/ui'
import { TronResourcesCard } from '../components/TronResourcesCard'
import { useTronResources } from '../lib/tronResources'
import { AccountAddress } from '../components/AccountAddress'
import { addressExplorerUrl, explorerTabTitle } from '../lib/explorer'
import { bitcoinAddressLabel, formatAmount } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useT } from '../i18n'

export default function HomePage() {
  const t = useT()
  const navigate = useNavigate()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const currentWallet = useWalletStore((s) => s.current)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const selectNetwork = useNetworkStore((s) => s.select)
  const current = currentNetworkOf({ networks, currentPk: networkPk })
  const open = useBrowserStore((s) => s.open)
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [faucets, setFaucets] = useState<FaucetRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  useEffect(() => {
    if (!networkPk) return
    const reload = () => {
      void portfolioApi.snapshot(networkPk).then(setSnapshot).catch(() => undefined)
    }
    const offTx = on(IPC_EVENT.transactionUpdated, reload)
    const offBal = on(IPC_EVENT.balanceUpdated, (payload) => {
      const snap = payload as PortfolioSnapshot
      if (snap?.networkPk === networkPk) setSnapshot(snap)
    })
    return () => {
      offTx()
      offBal()
    }
  }, [currentWalletId, networkPk])

  const isTestnet = current?.networkScope === 'testnet'

  useEffect(() => {
    if (!networkPk || !isTestnet) {
      setFaucets([])
      return
    }
    let alive = true
    void faucetApi
      .list(networkPk)
      .then((list) => {
        if (alive) setFaucets(list)
      })
      .catch(() => {
        if (alive) setFaucets([])
      })
    return () => {
      alive = false
    }
  }, [networkPk, isTestnet])

  const refresh = async () => {
    if (!networkPk) return
    setBusy(true)
    setError(null)
    try {
      setSnapshot(await portfolioApi.refresh(networkPk))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const isBitcoin = current?.walletType === 'bitcoin'
  const isTron = current?.walletType === 'tron'
  const accountEntries = useMemo(() => uniqueAccountEntries(snapshot?.entries ?? []), [snapshot])
  const tronAccounts = useMemo(
    () => accountEntries.filter((entry) => entry.accountId).map((entry) => ({ accountId: entry.accountId! })),
    [accountEntries],
  )

  const goTransfer = (tab: 'receive' | 'send', entry: AssetEntry) => {
    if (entry.networkPk && entry.networkPk !== networkPk) {
      void selectNetwork(entry.networkPk)
    }
    navigate('/transfer', {
      state: {
        tab,
        networkPk: entry.networkPk,
        tokenPk: entry.tokenPk,
        accountId: entry.accountId,
      },
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('home.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {currentWallet ? currentWallet.name : t('home.createWallet')}
            {current ? ` · ${current.networkName}` : ''}
          </p>
        </div>
        <Button disabled={busy || !networkPk} onClick={() => void refresh()}>
          {busy ? t('home.refreshing') : t('home.refresh')}
        </Button>
      </div>

      <Alert>{error}</Alert>
      {snapshot?.offline ? (
        <p className="rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2 text-xs text-honey-400">
          {t('home.offline')}
        </p>
      ) : null}
      {snapshot?.priceError ? (
        <p className="rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2 text-xs text-honey-400">
          {snapshot.priceError}
        </p>
      ) : null}

      {isTestnet ? (
        <Card
          title={t('home.faucet')}
          action={
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => navigate('/faucets')}>
              {t('home.maintain')}
            </Button>
          }
        >
          {faucets.length === 0 ? (
            <p className="text-sm text-ink-400">{t('home.noFaucet')}</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {faucets.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink-200">{item.label || item.url}</p>
                    <p className="truncate font-mono text-[11px] text-ink-500">{item.url}</p>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-2 py-1 text-xs"
                    onClick={() => open(item.url, item.label || explorerTabTitle(item.url))}
                  >
                    {t('common.open')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      <Card>
        <p className="text-xs text-ink-500">{t('home.totalAssets', { code: snapshot?.currencyCode ?? 'CNY' })}</p>
        <p className="mt-1 text-3xl font-semibold text-ink-100">
          {snapshot?.totalCurrency ?? '--'}
        </p>
        {accountEntries.length > 0 ? (
          <div className="mt-4 space-y-2 border-t border-ink-700 pt-3">
            <p className="text-xs text-ink-500">{t('home.accounts')}</p>
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
          <p className="mt-3 text-xs text-ink-500">{t('home.noDerived')}</p>
        ) : null}
      </Card>

      {isTron
        ? tronAccounts.map((item) => (
            <HomeTronResources key={item.accountId} accountId={item.accountId} networkPk={networkPk} />
          ))
        : null}

      <Card title={t('home.tokens')}>
        {!snapshot || snapshot.entries.length === 0 ? (
          <p className="text-sm text-ink-400">{t('home.noAssets')}</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {snapshot.entries.map((entry) => (
              <li key={entry.key} className="py-3">
                <div className="flex items-center gap-3">
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
                      {entry.stale ? <span className="text-[10px] text-honey-400">{t('home.cached')}</span> : null}
                    </div>
                    {!entry.address ? (
                      <p className="truncate text-[11px] text-ink-500">{t('home.noDerived')}</p>
                    ) : entry.error ? (
                      <p className="truncate text-[11px] text-ink-500">{entry.error}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-ink-200">
                      {formatAmount(entry.balance)} {entry.symbol}
                    </p>
                    <p className="text-[11px] text-ink-500">
                      {entry.currencyBalance ?? '--'} {snapshot.currencyCode}
                    </p>
                  </div>
                </div>
                {entry.address ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => goTransfer('receive', entry)}
                    >
                      {t('home.goReceive')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => goTransfer('send', entry)}
                    >
                      {t('home.goSend')}
                    </Button>
                    {isBitcoin ? (
                      <AccountAddress
                        address={entry.address}
                        explorerUrl={current ? addressExplorerUrl(current, entry.address) : null}
                      />
                    ) : null}
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

function HomeTronResources({ accountId, networkPk }: { accountId: string; networkPk: string }) {
  const { resources, loading, error, reload } = useTronResources(accountId, networkPk, true)
  return <TronResourcesCard resources={resources} loading={loading} error={error} onRefresh={reload} />
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
