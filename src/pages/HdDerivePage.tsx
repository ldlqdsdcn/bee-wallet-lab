import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BitcoinAddressType, HdDerivedEvmKey, HdKeyQuery, HdKeyRecord, NetworkRecord, WalletType } from '@shared/types'
import { accountApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Modal, Select } from '../components/ui'
import { shorten } from '../lib/format'
import { useT, type MessageKey } from '../i18n'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'

const PAGE_SIZE = 50

const BTC_TYPES: { value: BitcoinAddressType; label: string }[] = [
  { value: 'p2wpkh', label: 'Native SegWit (bc1q)' },
  { value: 'p2tr', label: 'Taproot (bc1p)' },
  { value: 'p2sh-p2wpkh', label: 'Nested SegWit (3…)' },
  { value: 'p2pkh', label: 'Legacy (1…)' },
]

function chainLabel(type: WalletType, t: (key: MessageKey) => string): string {
  if (type === 'web3') return 'EVM'
  if (type === 'tron') return t('hd.chainTron')
  if (type === 'solana') return 'Solana'
  return 'Bitcoin'
}

function pathHint(network: NetworkRecord | null, addressType: BitcoinAddressType): string {
  if (!network) return ''
  switch (network.walletType) {
    case 'web3':
      return "m/44'/60'/{account}'/0/{index}"
    case 'tron':
      return "m/44'/195'/{account}'/0/{index}"
    case 'solana':
      return "m/44'/501'/{account}'/{index}'"
    case 'bitcoin': {
      const purpose = { p2pkh: 44, 'p2sh-p2wpkh': 49, p2wpkh: 84, p2tr: 86 }[addressType]
      const coin = network.networkScope === 'testnet' ? 1 : 0
      return `m/${purpose}'/${coin}'/{account}'/0/{index}`
    }
  }
}

function hdQuery(
  walletId: string,
  network: NetworkRecord,
  addressType: BitcoinAddressType,
  accountIndex?: number,
): HdKeyQuery {
  return {
    walletId,
    walletType: network.walletType,
    accountIndex,
    ...(network.walletType === 'bitcoin' ? { networkScope: network.networkScope, addressType } : {}),
  }
}

function asRow(item: HdKeyRecord): HdDerivedEvmKey {
  return {
    id: item.id,
    index: item.addressIndex,
    path: item.path,
    address: item.address,
    publicKey: item.publicKey,
  }
}

function exportCsv(walletName: string, rows: HdDerivedEvmKey[]): void {
  const header = 'index,path,address,publicKey,privateKey'
  const lines = rows.map(
    (row) => `${row.index},${row.path},${row.address},${row.publicKey},${row.privateKey ?? ''}`,
  )
  const blob = new Blob([`${header}\n${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const first = rows[0]?.index ?? 0
  const last = rows[rows.length - 1]?.index ?? 0
  link.download = `${walletName}-hd-${first}-${last}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function HdDerivePage() {
  const t = useT()
  const current = useWalletStore((s) => s.current)
  const currentId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const evm = network?.walletType === 'web3'
  const [addressType, setAddressType] = useState<BitcoinAddressType>('p2wpkh')
  const [toIndex, setToIndex] = useState('20000')
  const [fromIndex, setFromIndex] = useState('1')
  const [accountIndex, setAccountIndex] = useState('0')
  const [password, setPassword] = useState('')
  const [rows, setRows] = useState<HdDerivedEvmKey[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hideKeys, setHideKeys] = useState(true)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<HdDerivedEvmKey | null>(null)

  useEffect(() => {
    setQuery('')
    setPassword('')
    setError(null)
    setMessage(null)
    setHideKeys(true)
    setPage(1)
    setDetail(null)
    setRows([])
    if (!currentId || !network) return
    let alive = true
    void accountApi
      .hdKeyList(hdQuery(currentId, network, addressType))
      .then((list) => {
        if (!alive) return
        setRows(list.map(asRow))
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [currentId, networkPk, network?.walletType, network?.networkScope, addressType])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (row) =>
        String(row.index) === q ||
        row.address.toLowerCase().includes(q) ||
        row.path.includes(q) ||
        row.publicKey.toLowerCase().includes(q),
    )
  }, [rows, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [query])

  const count = useMemo(() => {
    const from = Number(fromIndex)
    const to = Number(toIndex)
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return 0
    return to - from + 1
  }, [fromIndex, toIndex])

  const unlocked = rows.length > 0 && rows.every((row) => row.privateKey)

  const run = async (fn: () => Promise<void>) => {
    if (!currentId) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    if (!currentId || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      if (!network) throw new Error(t('hd.needNetwork'))
      const query = hdQuery(currentId, network, addressType, Number(accountIndex))
      const next = await accountApi.hdDeriveEvm({
        walletId: currentId,
        password,
        fromIndex: Number(fromIndex),
        toIndex: Number(toIndex),
        accountIndex: Number(accountIndex),
        walletType: network.walletType,
        networkScope: network.networkScope,
        addressType: network.walletType === 'bitcoin' ? addressType : null,
      })
      const list = await accountApi.hdKeyList(query)
      const unlocked = new Map(next.rows.map((row) => [row.index, row.privateKey]))
      setRows(
        list.map((item) => ({
          ...asRow(item),
          privateKey: unlocked.get(item.addressIndex),
        })),
      )
      setPage(1)
      setPassword('')
      setMessage(
        next.skipped > 0
          ? t('hd.skipped', { skipped: next.skipped, saved: next.saved })
          : t('hd.saved', { saved: next.saved }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('hd.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {current ? t('hd.currentWallet', { name: current.name }) : t('hd.pickWallet')}
            {' · '}
            {network ? network.networkName : t('hd.pickNetwork')}
            {network
              ? ` · ${chainLabel(network.walletType, t)} · ${pathHint(network, addressType)}`
              : ''}
          </p>
        </div>
        {evm ? (
          <Link
            to="/hd-airdrop"
            className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-honey-500 hover:text-honey-400"
          >
            {t('nav.airdrop')}
          </Link>
        ) : null}
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2 text-xs text-honey-400">{message}</p> : null}

      {!network ? (
        <Card title={t('hd.needNetwork')}>
          <p className="text-sm text-ink-400">{t('hd.needNetworkBody')}</p>
          <Button className="mt-3" variant="ghost" onClick={openPicker}>
            {t('network.switch')}
          </Button>
        </Card>
      ) : (
        <>
      <Card title={t('hd.batch')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={t('hd.fromIndex')}
            type="number"
            min={0}
            value={fromIndex}
            hint={t('hd.fromHint', { chain: chainLabel(network.walletType, t) })}
            onChange={(e) => setFromIndex(e.target.value)}
          />
          <Field
            label={t('hd.toIndex')}
            type="number"
            min={0}
            max={20_000}
            value={toIndex}
            hint={t('hd.toHint')}
            onChange={(e) => setToIndex(e.target.value)}
          />
          {network.walletType === 'bitcoin' ? (
            <Select
              label={t('hd.addrType')}
              value={addressType}
              hint={t('hd.addrTypeHint')}
              onChange={(e) => setAddressType(e.target.value as BitcoinAddressType)}
            >
              {BTC_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          ) : null}
          <Field
            label={t('hd.account')}
            type="number"
            min={0}
            value={accountIndex}
            hint={t('hd.accountHint')}
            onChange={(e) => setAccountIndex(e.target.value)}
          />
          <Field
            label={t('common.password')}
            type="password"
            value={password}
            hint={t('hd.passwordHint')}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password && currentId && !busy && !saving) {
                void generate()
              }
            }}
          />
        </div>
        <p className="mt-3 text-xs text-honey-400">
          {t('hd.willWrite', { count: count || 0 })}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || saving || !currentId || !password || count <= 0} onClick={() => void generate()}>
            {saving ? t('hd.generating') : t('hd.generate')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || saving || !currentId || !password || rows.length === 0}
            onClick={() =>
              void run(async () => {
                if (!currentId) return
                if (!network) return
                const unlockedRows = await accountApi.hdKeyUnlock({
                  ...hdQuery(currentId, network, addressType),
                  password,
                })
                setRows(unlockedRows)
                setHideKeys(false)
                setPassword('')
              })
            }
          >
            {t('hd.unlockKeys')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || saving || rows.length === 0 || !unlocked}
            onClick={() => exportCsv(current?.name ?? 'hd', rows)}
          >
            {t('hd.exportCsv')}
          </Button>
          <Button variant="ghost" disabled={saving || rows.length === 0} onClick={() => setHideKeys((value) => !value)}>
            {hideKeys ? t('hd.showKeys') : t('hd.hideKeys')}
          </Button>
          <Button
            variant="ghost"
            className="hover:border-red-500 hover:text-red-400"
            disabled={busy || saving || !currentId || !password || rows.length === 0}
            onClick={() =>
              void run(async () => {
                if (!currentId) return
                if (!network) return
                if (
                  !window.confirm(
                    t('hd.clearConfirm', {
                      wallet: current?.name ?? t('wallet.current'),
                      network: network.networkName,
                      count: rows.length,
                    }),
                  )
                )
                  return
                await accountApi.hdKeyClear({
                  ...hdQuery(currentId, network, addressType),
                  password,
                })
                setRows([])
                setPage(1)
                setPassword('')
              })
            }
          >
            {t('hd.clear')}
          </Button>
        </div>
      </Card>

      <Card
        title={t('hd.tableTitle', {
          wallet: current?.name ?? t('hd.unselected'),
          shown: filtered.length,
          total: rows.length,
          size: PAGE_SIZE,
        })}
        action={
          <input
            className="w-64 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm text-ink-200 outline-none placeholder:text-ink-600 focus:border-honey-500"
            placeholder={t('hd.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">
            {current
              ? t('hd.emptyWallet', { wallet: current.name, network: network.networkName })
              : t('hd.emptyNoWallet')}
          </p>
        ) : (
          <>
            <KeyTable rows={pageRows} hideKeys={hideKeys} onDetail={setDetail} />
            <Pager page={currentPage} pageCount={pageCount} total={filtered.length} onPage={setPage} />
          </>
        )}
      </Card>
        </>
      )}
      {detail ? (
        <HdKeyDetailDialog
          row={detail}
          walletId={currentId}
          onClose={() => setDetail(null)}
          onUnlocked={(next) => {
            setRows((prev) => prev.map((item) => (item.id === next.id ? next : item)))
            setDetail(next)
          }}
        />
      ) : null}
      {saving ? <SavingOverlay count={count} /> : null}
    </div>
  )
}

function SavingOverlay({ count }: { count: number }) {
  const t = useT()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-ink-600 bg-ink-900 px-6 py-8 text-center shadow-2xl">
        <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-ink-600 border-t-honey-400" />
        <p className="mt-4 text-sm font-medium text-ink-100">{t('hd.progressTitle')}</p>
        <p className="mt-2 text-xs text-ink-400">
          {t('hd.progressBody', { count })}
        </p>
      </div>
    </div>
  )
}

function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number
  pageCount: number
  total: number
  onPage: (page: number) => void
}) {
  const t = useT()
  const [jump, setJump] = useState(String(page))
  useEffect(() => {
    setJump(String(page))
  }, [page])

  const go = (next: number) => {
    const clamped = Math.min(pageCount, Math.max(1, next))
    onPage(clamped)
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
      <span>
        {t('hd.pageRange', {
          from: (page - 1) * PAGE_SIZE + 1,
          to: Math.min(page * PAGE_SIZE, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
          {t('common.prev')}
        </button>
        <span>
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
          disabled={page >= pageCount}
          onClick={() => go(page + 1)}
        >
          {t('common.next')}
        </button>
        <input
          className="w-16 rounded border border-ink-600 bg-ink-900 px-2 py-1 text-center text-ink-200 outline-none focus:border-honey-500"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(Number(jump))
          }}
        />
        <button type="button" className="rounded px-2 py-1 hover:bg-ink-800" onClick={() => go(Number(jump))}>
          {t('common.jump')}
        </button>
      </div>
    </div>
  )
}

function KeyTable({
  rows,
  hideKeys,
  onDetail,
}: {
  rows: HdDerivedEvmKey[]
  hideKeys: boolean
  onDetail: (row: HdDerivedEvmKey) => void
}) {
  const t = useT()
  return (
    <div className="overflow-auto rounded-lg border border-ink-700">
      <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_64px] gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2 text-[11px] text-ink-500">
        <span>{t('hd.colIndex')}</span>
        <span>{t('hd.colPath')}</span>
        <span>{t('hd.colAddress')}</span>
        <span>{t('hd.colPub')}</span>
        <span>{t('hd.colKey')}</span>
        <span>{t('hd.colAction')}</span>
      </div>
      {rows.map((row) => (
        <Row key={row.id ?? row.path} row={row} hideKeys={hideKeys} onDetail={onDetail} />
      ))}
    </div>
  )
}

function Row({
  row,
  hideKeys,
  onDetail,
}: {
  row: HdDerivedEvmKey
  hideKeys: boolean
  onDetail: (row: HdDerivedEvmKey) => void
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_64px] items-center gap-2 border-b border-ink-800 px-3 py-2.5 text-xs">
      <span className="text-ink-400">{row.index}</span>
      <span className="truncate font-mono text-[11px] text-ink-500" title={row.path}>
        {row.path}
      </span>
      <CopyCell value={row.address} display={shorten(row.address, 8, 6)} />
      <CopyCell value={row.publicKey} display={shorten(row.publicKey, 8, 6)} />
      {row.privateKey ? (
        <CopyCell
          value={row.privateKey}
          display={hideKeys ? '••••••••' : shorten(row.privateKey, 8, 6)}
          sensitive
        />
      ) : (
        <span className="text-[11px] text-ink-600">{t('hd.encrypted')}</span>
      )}
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onDetail(row)}>
        {t('hd.detail')}
      </Button>
    </div>
  )
}

function HdKeyDetailDialog({
  row,
  walletId,
  onClose,
  onUnlocked,
}: {
  row: HdDerivedEvmKey
  walletId: string | null
  onClose: () => void
  onUnlocked: (row: HdDerivedEvmKey) => void
}) {
  const t = useT()
  const [password, setPassword] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reveal = async () => {
    if (!walletId || !row.id || !password) return
    setBusy(true)
    setError(null)
    try {
      const next = await accountApi.hdKeyReveal(walletId, row.id, password)
      onUnlocked(next)
      setShowKey(true)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('hd.detailTitle')} onClose={onClose} wide>
      <p className="mt-1 text-xs text-ink-500">{t('hd.detailHint', { index: row.index })}</p>
      <div className="mt-4 space-y-3">
        <DetailField label={t('hd.colIndex')} value={String(row.index)} />
        <DetailField label={t('hd.path')} value={row.path} />
        <DetailField label={t('hd.colAddress')} value={row.address} />
        <DetailField label={t('hd.colPub')} value={row.publicKey} />
        {row.privateKey ? (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-400">{t('hd.colKey')}</span>
              <div className="flex gap-2">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? t('hd.hide') : t('hd.show')}
                </Button>
                <CopyButton value={row.privateKey} />
              </div>
            </div>
            <p className="sensitive break-all rounded-lg bg-ink-800 px-3 py-2 font-mono text-xs text-honey-400">
              {showKey ? row.privateKey : '••••••••••••••••••••••••••••••••••••••••'}
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-xs text-ink-400">{t('hd.unlockHint')}</p>
            <Field
              label={t('common.password')}
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password && !busy) void reveal()
              }}
            />
            {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
            <Button className="mt-3" disabled={busy || !walletId || !row.id || !password} onClick={() => void reveal()}>
              {busy ? t('wallets.checking') : t('hd.unlockKey')}
            </Button>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </Modal>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-400">{label}</span>
        <CopyButton value={value} />
      </div>
      <p className="break-all rounded-lg bg-ink-800 px-3 py-2 font-mono text-xs text-ink-200">{value}</p>
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      className="px-2 py-1 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? t('common.copied') : t('common.copy')}
    </Button>
  )
}

function CopyCell({
  value,
  display,
  sensitive,
}: {
  value: string
  display: string
  sensitive?: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`min-w-0 truncate text-left font-mono text-[11px] ${
        sensitive ? 'sensitive text-honey-400' : 'text-ink-200'
      } hover:text-honey-400`}
      title={copied ? t('common.copied') : value}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1000)
        })
      }}
    >
      {copied ? t('common.copied') : display}
    </button>
  )
}
