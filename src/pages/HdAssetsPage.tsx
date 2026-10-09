import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AddressPortfolio, BitcoinAddressType, HdKeyRecord, NetworkRecord } from '@shared/types'
import { accountApi, portfolioApi } from '../lib/bridge'
import { Alert, Button, Card } from '../components/ui'
import { AccountAddress } from '../components/AccountAddress'
import { addressExplorerUrl } from '../lib/explorer'
import { bitcoinAddressLabel, formatAmount } from '../lib/format'
import { useT } from '../i18n'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'

const PAGE_SIZE = 20

const BTC_TYPES: { value: BitcoinAddressType; label: string }[] = [
  { value: 'p2wpkh', label: 'Native SegWit (bc1q)' },
  { value: 'p2tr', label: 'Taproot (bc1p)' },
  { value: 'p2sh-p2wpkh', label: 'Nested SegWit (3…)' },
  { value: 'p2pkh', label: 'Legacy (1…)' },
]

function hdQuery(walletId: string, network: NetworkRecord, addressType: BitcoinAddressType) {
  return {
    walletId,
    walletType: network.walletType,
    ...(network.walletType === 'bitcoin' ? { networkScope: network.networkScope, addressType } : {}),
  }
}

export default function HdAssetsPage() {
  const t = useT()
  const navigate = useNavigate()
  const current = useWalletStore((s) => s.current)
  const currentId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const [addressType, setAddressType] = useState<BitcoinAddressType>('p2wpkh')
  const [keys, setKeys] = useState<HdKeyRecord[]>([])
  const [quotes, setQuotes] = useState<Record<string, AddressPortfolio>>({})
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingQuotes, setLoadingQuotes] = useState(false)

  useEffect(() => {
    if (!currentId || !network) {
      setKeys([])
      return
    }
    let alive = true
    setLoadingList(true)
    setError(null)
    void accountApi
      .hdKeyList(hdQuery(currentId, network, addressType))
      .then((rows) => {
        if (alive) setKeys(rows)
      })
      .catch((err) => {
        if (alive) {
          setKeys([])
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (alive) setLoadingList(false)
      })
    return () => {
      alive = false
    }
  }, [currentId, network, addressType])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return keys
    return keys.filter((row) => String(row.addressIndex) === q || row.address.toLowerCase().includes(q))
  }, [keys, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [query, currentId, networkPk, addressType])

  useEffect(() => {
    if (!networkPk || pageRows.length === 0) {
      setQuotes({})
      return
    }
    let alive = true
    setLoadingQuotes(true)
    void portfolioApi
      .addresses(
        networkPk,
        pageRows.map((row) => row.address),
      )
      .then((rows) => {
        if (!alive) return
        const next: Record<string, AddressPortfolio> = {}
        for (const row of rows) next[row.address.toLowerCase()] = row
        setQuotes(next)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive) setLoadingQuotes(false)
      })
    return () => {
      alive = false
    }
  }, [networkPk, pageRows.map((row) => row.address).join(',')])

  const refresh = () => {
    if (!networkPk || pageRows.length === 0) return
    setLoadingQuotes(true)
    void portfolioApi
      .addresses(
        networkPk,
        pageRows.map((row) => row.address),
      )
      .then((rows) => {
        const next: Record<string, AddressPortfolio> = {}
        for (const row of rows) next[row.address.toLowerCase()] = row
        setQuotes(next)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingQuotes(false))
  }

  const currencyCode = pageRows.map((row) => quotes[row.address.toLowerCase()]?.currencyCode).find(Boolean) ?? 'CNY'

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('hdAssets.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {current ? current.name : t('hd.pickWallet')}
            {network ? ` · ${network.networkName}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink-500">{t('hdAssets.hint')}</p>
        </div>
        <Button disabled={loadingQuotes || !networkPk || pageRows.length === 0} onClick={refresh}>
          {loadingQuotes ? t('home.refreshing') : t('home.refresh')}
        </Button>
      </div>

      <Alert>{error}</Alert>

      {network?.walletType === 'bitcoin' ? (
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs font-medium text-ink-400">{t('hd.addrType')}</span>
          <select
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none focus:border-honey-500"
            value={addressType}
            onChange={(event) => setAddressType(event.target.value as BitcoinAddressType)}
          >
            {BTC_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {!currentId ? (
        <p className="text-sm text-ink-400">{t('hd.emptyNoWallet')}</p>
      ) : !network ? (
        <p className="text-sm text-ink-400">{t('hd.pickNetwork')}</p>
      ) : loadingList ? (
        <p className="text-sm text-ink-400">{t('common.loading')}</p>
      ) : keys.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-400">
            {t('hdAssets.empty', { wallet: current?.name ?? t('hd.unselected'), network: network.networkName })}
          </p>
          <Button className="mt-3" variant="ghost" onClick={() => navigate('/hd')}>
            {t('hdAssets.goDerive')}
          </Button>
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input
              className="min-w-[12rem] flex-1 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none placeholder:text-ink-600 focus:border-honey-500"
              placeholder={t('hdAssets.search')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="text-xs text-ink-500">
              {t('hdAssets.page', {
                from: filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1,
                to: Math.min(currentPage * PAGE_SIZE, filtered.length),
                total: filtered.length,
              })}
            </p>
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-ink-400">{t('common.empty')}</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {pageRows.map((row) => {
                const quote = quotes[row.address.toLowerCase()]
                const amount = quote?.totalCurrency
                return (
                  <li key={row.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-sm text-ink-200">{row.address}</p>
                      <p className="mt-1 text-xs text-ink-500">
                        {loadingQuotes && !quote
                          ? t('hdAssets.loading')
                          : t('hdAssets.fiat', {
                              amount: amount ?? t('hdAssets.noQuote'),
                              code: quote?.currencyCode ?? currencyCode,
                            })}
                        {row.addressType ? ` · ${bitcoinAddressLabel(row.addressType)}` : ''}
                        {` · #${row.addressIndex}`}
                      </p>
                    </div>
                    <Button variant="ghost" className="shrink-0 px-2 py-1 text-xs" onClick={() => navigate(`/hd-assets/${row.id}`)}>
                      {t('hd.detail')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          {pageCount > 1 ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                {t('common.prev')}
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={currentPage >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  )
}

export function HdAssetDetailPage() {
  const t = useT()
  const navigate = useNavigate()
  const { keyId } = useParams<{ keyId: string }>()
  const currentId = useWalletStore((s) => s.currentId)
  const current = useWalletStore((s) => s.current)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const [key, setKey] = useState<HdKeyRecord | null>(null)
  const [portfolio, setPortfolio] = useState<AddressPortfolio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentId || !network || !keyId) {
      setKey(null)
      return
    }
    let alive = true
    void accountApi
      .hdKeyList({
        walletId: currentId,
        walletType: network.walletType,
        ...(network.walletType === 'bitcoin' ? { networkScope: network.networkScope } : {}),
      })
      .then((rows) => {
        if (!alive) return
        const hit = rows.find((row) => row.id === keyId) ?? null
        setKey(hit)
        if (!hit) setError(t('hdAssets.empty', { wallet: current?.name ?? t('hd.unselected'), network: network.networkName }))
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [currentId, network, keyId, current?.name, t])

  const loadQuote = async (address: string) => {
    if (!networkPk) return
    setBusy(true)
    setError(null)
    try {
      const [row] = await portfolioApi.addresses(networkPk, [address])
      setPortfolio(row ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (key?.address) void loadQuote(key.address)
    else setPortfolio(null)
  }, [key?.address, networkPk])

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('hdAssets.detailTitle')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {current ? current.name : t('hd.pickWallet')}
            {network ? ` · ${network.networkName}` : ''}
            {key ? ` · #${key.addressIndex}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/hd-assets')}>
            {t('hdAssets.back')}
          </Button>
          <Button disabled={busy || !key} onClick={() => key && void loadQuote(key.address)}>
            {busy ? t('home.refreshing') : t('home.refresh')}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>

      {key ? (
        <Card>
          <AccountAddress
            address={key.address}
            label={key.addressType ? bitcoinAddressLabel(key.addressType) : undefined}
            explorerUrl={network ? addressExplorerUrl(network, key.address) : null}
          />
          <p className="mt-3 text-xs text-ink-500">{t('home.totalAssets', { code: portfolio?.currencyCode ?? 'CNY' })}</p>
          <p className="mt-1 text-3xl font-semibold text-ink-100">{portfolio?.totalCurrency ?? t('hdAssets.noQuote')}</p>
          {portfolio?.offline ? <p className="mt-2 text-xs text-honey-400">{t('home.offline')}</p> : null}
          {portfolio?.priceError ? <p className="mt-2 text-xs text-honey-400">{portfolio.priceError}</p> : null}
        </Card>
      ) : (
        <p className="text-sm text-ink-400">{t('common.loading')}</p>
      )}

      <Card title={t('home.tokens')}>
        {!portfolio || portfolio.entries.length === 0 ? (
          <p className="text-sm text-ink-400">{busy ? t('hdAssets.loading') : t('home.noAssets')}</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {portfolio.entries.map((entry) => (
              <li key={entry.key} className="flex items-center gap-3 py-3">
                {entry.iconUrl ? (
                  <img src={entry.iconUrl} alt="" className="h-8 w-8 rounded-full" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-700 text-xs text-honey-400">
                    {entry.symbol.slice(0, 3)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-200">{entry.name}</p>
                  {entry.error ? <p className="truncate text-[11px] text-ink-500">{entry.error}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-sm text-ink-200">
                    {formatAmount(entry.balance)} {entry.symbol}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {entry.currencyBalance ?? t('hdAssets.noQuote')} {portfolio.currencyCode}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
