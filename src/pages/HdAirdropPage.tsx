import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { collectRecipientAddresses, mergeRecipientText } from '@shared/airdropAddresses'
import { collectItemizedEntries, newItemizedRow } from '@shared/airdropEntries'
import { IPC_EVENT } from '@shared/ipc'
import type {
  AccountRecord,
  HdAirdropAmountMode,
  HdAirdropInput,
  HdAirdropItem,
  HdAirdropItemPage,
  HdAirdropItemStatus,
  HdAirdropJob,
  HdAirdropJobKind,
  HdAirdropPreview,
  TokenRecord,
} from '@shared/types'
import { useAccountBalances } from '../lib/accountBalances'
import { accountApi, catalogApi, hdAirdropApi, on, portfolioApi } from '../lib/bridge'
import AddressBookPicker from '../components/AddressBookPicker'
import { AirdropItemizedEditor, type ItemizedRow } from '../components/AirdropItemizedEditor'
import { AirdropPayerPicker, type AirdropPayer } from '../components/AirdropPayerPicker'
import { Alert, Button, Card, Field, Modal, TextArea } from '../components/ui'
import { TokenSelect } from '../components/TokenSelect'
import { AccountAddress } from '../components/AccountAddress'
import { addressExplorerUrl, explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, shorten } from '../lib/format'
import { useT, type MessageKey } from '../i18n'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'

const PAGE_SIZE = 50

function isErc20(token: TokenRecord): boolean {
  if (!token.isToken) return false
  const value = token.contractAddress?.trim() ?? ''
  return Boolean(value && value !== '0' && !/^0x0+$/i.test(value))
}

function isAirdropAsset(token: TokenRecord): boolean {
  return !token.isToken || isErc20(token)
}

function jobLabel(status: HdAirdropJob['status'], t: (key: MessageKey) => string): string {
  if (status === 'running') return t('airdrop.stRunning')
  if (status === 'done') return t('airdrop.stDone')
  if (status === 'stopped') return t('airdrop.stStopped')
  return t('airdrop.stFailed')
}

function jobClass(status: HdAirdropJob['status']): string {
  if (status === 'running') return 'text-honey-400'
  if (status === 'done') return 'text-emerald-400'
  if (status === 'stopped') return 'text-ink-400'
  return 'text-red-300'
}

function itemLabel(status: HdAirdropItemStatus, t: (key: MessageKey) => string): string {
  if (status === 'confirmed') return t('airdrop.itConfirmed')
  if (status === 'pending') return t('airdrop.itPending')
  if (status === 'failed') return t('airdrop.itFailed')
  if (status === 'queued') return t('airdrop.itQueued')
  return t('airdrop.itSkipped')
}

function itemClass(status: HdAirdropItemStatus): string {
  if (status === 'confirmed') return 'text-emerald-400'
  if (status === 'pending') return 'text-honey-400'
  if (status === 'failed') return 'text-red-300'
  if (status === 'queued') return 'text-ink-400'
  return 'text-ink-500'
}

function formatEta(ms: number, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return t('airdrop.sec', { n: seconds })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('airdrop.min', { n: minutes })
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? t('airdrop.hourMin', { h: hours, m: rem }) : t('airdrop.hour', { n: hours })
}

function formatTime(at: number | null): string {
  if (!at) return ''
  return new Date(at).toLocaleString()
}

export default function HdAirdropPage() {
  const t = useT()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const currentWallet = useWalletStore((s) => s.current)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const openExplorer = useBrowserStore((s) => s.open)

  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [accountId, setAccountId] = useState('')
  const [payer, setPayer] = useState<AirdropPayer | null>(null)
  const [payerBalance, setPayerBalance] = useState<string | null>(null)
  const [tokenPk, setTokenPk] = useState('')
  const [tab, setTab] = useState<HdAirdropJobKind>('uniform')
  const [recipientText, setRecipientText] = useState('')
  const [itemizedRows, setItemizedRows] = useState<ItemizedRow[]>(() => [newItemizedRow()])
  const [amountMode, setAmountMode] = useState<HdAirdropAmountMode>('fixed')
  const [amount, setAmount] = useState('1000')
  const [amountMin, setAmountMin] = useState('1000')
  const [amountMax, setAmountMax] = useState('2000')
  const [preview, setPreview] = useState<HdAirdropPreview | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [jobs, setJobs] = useState<HdAirdropJob[]>([])
  const [job, setJob] = useState<HdAirdropJob | null>(null)
  const [itemPage, setItemPage] = useState<HdAirdropItemPage | null>(null)
  const [itemFilter, setItemFilter] = useState<HdAirdropItemStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [starting, setStarting] = useState(false)
  const [foreignRunning, setForeignRunning] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  const evm = network?.walletType === 'web3'
  const assets = useMemo(() => tokens.filter(isAirdropAsset), [tokens])
  const balances = useAccountBalances(accountId, networkPk)
  const token = tokens.find((item) => item.id === tokenPk)
  const tokenBalance = payerBalance ?? balances.of(tokenPk)
  const running = job?.status === 'running'
  const transferring = running || starting
  const selectedId = job?.id

  const reloadJobs = async (preferId?: string) => {
    if (!currentWalletId) {
      setJobs([])
      return
    }
    const list = await hdAirdropApi.jobs(currentWalletId, networkPk || undefined, tab)
    setJobs(list)
    setJob((current) => {
      const want = preferId ?? current?.id
      return (want ? list.find((item) => item.id === want) : null) ?? list[0] ?? null
    })
  }

  const reloadItems = async (jobId: string, nextPage = page, filter = itemFilter) => {
    const result = await hdAirdropApi.items({
      jobId,
      status: filter === 'all' ? undefined : filter,
      page: nextPage,
      pageSize: PAGE_SIZE,
    })
    setItemPage(result)
  }

  useEffect(() => {
    if (!currentWalletId) {
      setAccounts([])
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
  }, [currentWalletId])

  useEffect(() => {
    if (!networkPk) {
      setTokens([])
      setTokenPk('')
      return
    }
    let alive = true
    void catalogApi
      .tokens(networkPk)
      .then((list) => {
        if (!alive) return
        const next = list.filter(isAirdropAsset)
        setTokens(list)
        setTokenPk((pk) => (next.find((item) => item.id === pk) ? pk : next[0]?.id ?? ''))
      })
      .catch((err) => {
        if (!alive) return
        setTokens([])
        setTokenPk('')
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [networkPk])

  useEffect(() => {
    setPreview(null)
  }, [tab, networkPk, currentWalletId, accountId, payer?.hdKeyId, tokenPk, recipientText, itemizedRows, amountMode, amount, amountMin, amountMax])

  useEffect(() => {
    setPage(1)
    setItemFilter('all')
    void reloadJobs().catch((err) => setError(err instanceof Error ? err.message : String(err)))
    void hdAirdropApi
      .status()
      .then((current) => {
        setForeignRunning(Boolean(current && current.status === 'running' && (current.jobKind ?? 'uniform') !== tab))
      })
      .catch(() => undefined)
  }, [currentWalletId, networkPk, tab])

  useEffect(() => {
    return on(IPC_EVENT.hdAirdropProgress, (payload) => {
      const next = payload as HdAirdropJob
      const kind = next.jobKind ?? 'uniform'
      if (kind !== tab) {
        setForeignRunning(next.status === 'running')
        return
      }
      setForeignRunning(false)
      setJob((current) => (current && current.id !== next.id ? current : next))
      setJobs((list) => {
        const others = list.filter((item) => item.id !== next.id)
        return [next, ...others].slice(0, 50)
      })
    })
  }, [tab])

  useEffect(() => {
    if (!selectedId) {
      setItemPage(null)
      return
    }
    void reloadItems(selectedId, page, itemFilter).catch(() => undefined)
  }, [selectedId, page, itemFilter, job?.sent, job?.failed, job?.queued, job?.confirmed, job?.pending])

  const filteredAccounts = useMemo(() => {
    if (!evm) return []
    return accounts.filter((item) => item.walletType === 'web3')
  }, [accounts, evm])

  useEffect(() => {
    const main = filteredAccounts[0]
    if (!main) {
      setAccountId('')
      setPayer(null)
      return
    }
    setAccountId(main.id)
    setPayer((current) => {
      if (current?.hdKeyId) return { ...current, accountId: main.id }
      if (current && filteredAccounts.some((item) => item.id === current.accountId)) return current
      return {
        accountId: main.id,
        hdKeyId: null,
        address: main.address,
        label: t('airdrop.mainAccount'),
      }
    })
  }, [filteredAccounts, t])

  useEffect(() => {
    if (!payer?.address || !networkPk || !tokenPk) {
      setPayerBalance(null)
      return
    }
    let alive = true
    void portfolioApi
      .tokenBalances({ networkPk, tokenPk, addresses: [payer.address] })
      .then((rows) => {
        if (alive) setPayerBalance(rows[0]?.balance ?? null)
      })
      .catch(() => {
        if (alive) setPayerBalance(null)
      })
    return () => {
      alive = false
    }
  }, [payer?.address, networkPk, tokenPk])

  const parsedRecipients = useMemo(() => collectRecipientAddresses(recipientText), [recipientText])
  const parsedEntries = useMemo(() => collectItemizedEntries(itemizedRows), [itemizedRows])

  const openJob = (item: HdAirdropJob, showModal = true) => {
    if (item.id !== job?.id) setItemPage(null)
    setJob(item)
    setPage(1)
    setItemFilter('all')
    if (showModal) {
      setDetailOpen(true)
      return
    }
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const buildInput = (): HdAirdropInput => ({
    walletId: currentWalletId ?? '',
    accountId: payer?.accountId || accountId,
    hdKeyId: payer?.hdKeyId ?? null,
    networkPk,
    tokenPk,
    jobKind: tab,
    recipients: tab === 'uniform' ? parsedRecipients.addresses : [],
    entries: tab === 'itemized' ? parsedEntries.entries : undefined,
    amountMode: tab === 'itemized' ? 'fixed' : amountMode,
    amount: tab === 'itemized' || amountMode === 'fixed' ? amount : undefined,
    amountMin: amountMode === 'range' ? amountMin : undefined,
    amountMax: amountMode === 'range' ? amountMax : undefined,
  })

  const onPickFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((text) => {
      setRecipientText((current) => mergeRecipientText(current, text))
    })
  }

  const run = async (fn: () => Promise<void>) => {
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

  const doneCount = job ? job.pending + job.confirmed + job.failed + job.skipped : 0
  const progress = job && job.total > 0 ? Math.round((doneCount / job.total) * 100) : 0
  const remainMs = job ? job.queued * 450 : 0
  const txUrl = job?.lastTxid && network ? txExplorerUrl(network, job.lastTxid) : null
  const pageCount = Math.max(1, Math.ceil((itemPage?.total ?? 0) / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('airdrop.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">
          {currentWallet ? t('hd.currentWallet', { name: currentWallet.name }) : t('airdrop.pickWallet')}
          {' · '}
          {network ? network.networkName : t('hd.pickNetwork')}
          {' · '}
          {t('airdrop.hint')}
        </p>
      </div>

      <Alert>{error}</Alert>
      {foreignRunning ? <Alert tone="pending">{t('airdrop.otherRunning')}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={tab === 'uniform' ? 'primary' : 'ghost'}
          className="px-3 py-1 text-xs"
          onClick={() => setTab('uniform')}
        >
          {t('airdrop.tabUniform')}
        </Button>
        <Button
          type="button"
          variant={tab === 'itemized' ? 'primary' : 'ghost'}
          className="px-3 py-1 text-xs"
          onClick={() => setTab('itemized')}
        >
          {t('airdrop.tabItemized')}
        </Button>
      </div>
      <p className="text-xs text-ink-500">{tab === 'itemized' ? t('airdrop.tabItemizedHint') : t('airdrop.tabUniformHint')}</p>

      {!evm ? (
        <Card title={t('airdrop.unsupported')}>
          <p className="text-sm text-ink-400">{t('airdrop.unsupportedBody')}</p>
          <Button className="mt-3" variant="ghost" onClick={openPicker}>
            {t('network.switch')}
          </Button>
        </Card>
      ) : (
        <Card title={t('airdrop.params')}>
          <div className="space-y-3">
            {currentWalletId && evm ? (
              <AirdropPayerPicker
                walletId={currentWalletId}
                accountId={accountId}
                walletType="web3"
                networkPk={networkPk}
                tokenPk={tokenPk}
                tokenSymbol={token?.symbol ?? ''}
                payer={payer}
                onSelect={setPayer}
              />
            ) : (
              <p className="text-sm text-ink-400">{t('airdrop.noEvm')}</p>
            )}

            <TokenSelect
              label={t('airdrop.token')}
              tokens={assets}
              value={tokenPk}
              onChange={setTokenPk}
              balances={
                payerBalance != null && tokenPk
                  ? { ...balances.byToken, [tokenPk]: payerBalance }
                  : balances.byToken
              }
            />
            <p className="text-[11px] text-ink-500">
              {balances.loading && tokenBalance == null
                ? t('common.loading')
                : t('common.balance', {
                    amount: tokenBalance != null ? formatAmount(tokenBalance) : '—',
                    symbol: token?.symbol ?? '',
                  })}
            </p>

            {tab === 'itemized' ? (
              <AirdropItemizedEditor rows={itemizedRows} onChange={setItemizedRows} walletType="web3" />
            ) : (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-ink-400">{t('airdrop.recipients')}</span>
                    <div className="flex items-center gap-3">
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.csv,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          onPickFile(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                      <button
                        type="button"
                        className="text-xs text-honey-400 hover:text-honey-500"
                        onClick={() => fileRef.current?.click()}
                      >
                        {t('airdrop.upload')}
                      </button>
                      {network ? (
                        <AddressBookPicker
                          multiple
                          walletType={network.walletType}
                          onSelectMany={(entries) =>
                            setRecipientText((current) =>
                              mergeRecipientText(current, entries.map((entry) => entry.address).join(',')),
                            )
                          }
                        />
                      ) : null}
                    </div>
                  </div>
                  <TextArea
                    className="sensitive min-h-28 font-mono text-xs"
                    value={recipientText}
                    placeholder={t('airdrop.recipientsPlaceholder')}
                    onChange={(e) => setRecipientText(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-ink-600">
                    {t('airdrop.recipientsHint')}
                    {recipientText.trim()
                      ? ` · ${t('airdrop.parsed', { count: parsedRecipients.addresses.length })}${
                          parsedRecipients.invalid.length
                            ? t('airdrop.parsedInvalid', { count: parsedRecipients.invalid.length })
                            : ''
                        }${
                          parsedRecipients.duplicateCount
                            ? t('airdrop.parsedDup', { count: parsedRecipients.duplicateCount })
                            : ''
                        }`
                      : ''}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={amountMode === 'fixed' ? 'primary' : 'ghost'}
                    className="px-3 py-1 text-xs"
                    onClick={() => setAmountMode('fixed')}
                  >
                    {t('airdrop.fixed')}
                  </Button>
                  <Button
                    type="button"
                    variant={amountMode === 'range' ? 'primary' : 'ghost'}
                    className="px-3 py-1 text-xs"
                    onClick={() => setAmountMode('range')}
                  >
                    {t('airdrop.random')}
                  </Button>
                </div>

                {amountMode === 'fixed' ? (
                  <Field
                    label={t('airdrop.each')}
                    value={amount}
                    hint={t('airdrop.eachHint')}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={t('airdrop.minAmount')}
                      value={amountMin}
                      hint={t('airdrop.minHint')}
                      onChange={(e) => setAmountMin(e.target.value)}
                    />
                    <Field
                      label={t('airdrop.max')}
                      value={amountMax}
                      hint={t('airdrop.maxHint')}
                      onChange={(e) => setAmountMax(e.target.value)}
                    />
                  </div>
                )}
              </>
            )}

            {assets.length === 0 ? (
              <p className="text-xs text-ink-500">{t('airdrop.noErc20')}</p>
            ) : null}

            {preview ? (
              <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {tab === 'itemized'
                    ? t('airdrop.previewItemized', {
                        from: shorten(preview.from),
                        count: preview.recipientCount,
                        total: preview.estimatedTotal,
                      })
                    : t('airdrop.previewLine', {
                        from: shorten(preview.from),
                        count: preview.recipientCount,
                        amount: preview.amountText,
                      })}
                </p>
                <p>{t('airdrop.estTotal', { total: preview.estimatedTotal })}</p>
                <p>{t('airdrop.estGas', { fee: preview.feeText })}</p>
                <p className="text-honey-400">{t('airdrop.estTime', { time: preview.estimatedText })}</p>
                {preview.warnings.map((item) => (
                  <p key={item} className="text-honey-400">
                    {item}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                disabled={busy || running || foreignRunning || !payer || !tokenPk || !currentWalletId}
                onClick={() =>
                  void run(async () => {
                    if (tab === 'itemized') {
                      if (parsedEntries.invalid.length > 0) {
                        throw new Error(
                          t('airdrop.invalidAddresses', {
                            count: parsedEntries.invalid.length,
                            sample: parsedEntries.invalid.slice(0, 3).join(', '),
                          }),
                        )
                      }
                      if (parsedEntries.entries.length === 0) {
                        throw new Error(parsedEntries.missingAmount ? t('airdrop.needAmounts') : t('airdrop.needRows'))
                      }
                      if (parsedEntries.missingAmount > 0) {
                        throw new Error(t('airdrop.needAmounts'))
                      }
                    } else {
                      if (parsedRecipients.invalid.length > 0) {
                        throw new Error(
                          t('airdrop.invalidAddresses', {
                            count: parsedRecipients.invalid.length,
                            sample: parsedRecipients.invalid.slice(0, 3).join(', '),
                          }),
                        )
                      }
                      if (parsedRecipients.addresses.length === 0) {
                        throw new Error(t('airdrop.needAddresses'))
                      }
                    }
                    setPreview(await hdAirdropApi.preview(buildInput()))
                  })
                }
              >
                {t('common.preview')}
              </Button>
              <Button
                loading={transferring}
                disabled={busy || transferring || foreignRunning || !preview}
                onClick={() =>
                  void run(async () => {
                    if (!preview) return
                    setStarting(true)
                    try {
                      const next = await hdAirdropApi.start(preview.draftId)
                      setJob(next)
                      setPreview(null)
                      setItemFilter('all')
                      setPage(1)
                      await reloadJobs(next.id)
                    } finally {
                      setStarting(false)
                    }
                  })
                }
              >
                {transferring ? t('airdrop.transferring') : t('airdrop.start')}
              </Button>
              <Button
                variant="danger"
                disabled={!running}
                onClick={() =>
                  void run(async () => {
                    const next = await hdAirdropApi.stop(job?.id)
                    if (next) setJob(next)
                  })
                }
              >
                {t('airdrop.stop')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {job ? (
        <div ref={detailRef}>
        <Card
          title={job.status === 'running' ? t('airdrop.progress') : t('airdrop.detail')}
          action={<span className={`text-xs ${jobClass(job.status)}`}>{jobLabel(job.status, t)}</span>}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-ink-200">
              <span>
                {t('airdrop.done', { done: doneCount, total: job.total })}
                {job.currentIndex != null ? ` · ${t('airdrop.current', { index: job.currentIndex })}` : ''}
              </span>
              <span className="tabular-nums text-honey-400">{progress}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-ink-900">
              <div className="h-full bg-honey-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-ink-400">
              {t('airdrop.progressHint', {
                ok: job.confirmed,
                pending: job.pending,
                failed: job.failed,
                queued: job.queued,
                skipped: job.skipped,
              })}
            </p>
            {job.status === 'running' ? (
              <p className="text-xs text-ink-500">
                {t('airdrop.remain', { queued: job.queued, eta: formatEta(remainMs, t) })}
              </p>
            ) : (
              <p className="text-xs text-ink-500">
                {t('airdrop.detailFrom', { from: shorten(job.fromAddress) })}
                {job.startedAt ? ` · ${formatTime(job.startedAt)}` : ''}
              </p>
            )}
            {job.lastTxid ? (
              <p className="sensitive break-all font-mono text-[11px] text-ink-400">{job.lastTxid}</p>
            ) : null}
            {job.lastError ? <p className="text-xs text-red-300">{job.lastError}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={busy || running || job.failed === 0}
                onClick={() =>
                  void run(async () => {
                    const next = await hdAirdropApi.retry({ jobId: job.id, scope: 'failed' })
                    setJob(next)
                    setItemFilter('failed')
                    setPage(1)
                  })
                }
              >
                {t('airdrop.retryFailed', { count: job.failed })}
              </Button>
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={busy || running || job.queued === 0}
                onClick={() =>
                  void run(async () => {
                    const next = await hdAirdropApi.retry({ jobId: job.id, scope: 'queued' })
                    setJob(next)
                    setItemFilter('queued')
                    setPage(1)
                  })
                }
              >
                {t('airdrop.continue', { count: job.queued })}
              </Button>
              {txUrl ? (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}
                >
                  {t('airdrop.lastTx')}
                </Button>
              ) : null}
              <Link
                to="/activity"
                className="inline-flex items-center rounded-lg border border-ink-600 px-2 py-1 text-xs text-ink-200 hover:border-honey-500 hover:text-honey-400"
              >
                {t('nav.activity')}
              </Link>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {(
                [
                  ['all', t('airdrop.filterAll'), job.total],
                  ['failed', t('airdrop.itFailed'), job.failed],
                  ['queued', t('airdrop.itQueued'), job.queued],
                  ['pending', t('airdrop.itPending'), job.pending],
                  ['confirmed', t('airdrop.itConfirmed'), job.confirmed],
                  ['skipped', t('airdrop.skip'), job.skipped],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded px-2 py-1 ${
                    itemFilter === key ? 'bg-ink-700 text-honey-400' : 'text-ink-400 hover:bg-ink-800'
                  }`}
                  onClick={() => {
                    setItemFilter(key)
                    setPage(1)
                  }}
                >
                  {label} {count}
                </button>
              ))}
            </div>

            {itemPage && itemPage.items.length > 0 ? (
              <>
                <ItemTable
                  items={itemPage.items}
                  symbol={job.symbol}
                  network={network}
                  running={running || busy}
                  onRetry={(item) =>
                    void run(async () => {
                      const next = await hdAirdropApi.retry({ jobId: job.id, itemIds: [item.id] })
                      setJob(next)
                    })
                  }
                />
                <Pager page={page} pageCount={pageCount} total={itemPage.total} onPage={setPage} />
              </>
            ) : (
              <p className="text-sm text-ink-400">{t('airdrop.noRows')}</p>
            )}
          </div>
        </Card>
        </div>
      ) : null}

      {jobs.length > 0 ? (
        <Card title={t('airdrop.history', { count: jobs.length })}>
          <ul className="divide-y divide-ink-700">
            {jobs.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full items-start justify-between gap-3 py-3 text-left ${
                    item.id === selectedId ? 'text-honey-400' : 'text-ink-200'
                  }`}
                  onClick={() => openJob(item)}
                >
                  <span>
                    <span className="text-sm">
                      {item.symbol} · {t('airdrop.jobCount', { count: item.total })} · {item.amountText}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-500">
                      {t('airdrop.jobMeta', {
                        ok: item.confirmed,
                        pending: item.pending,
                        failed: item.failed,
                        queued: item.queued,
                        total: item.total,
                      })}
                      {item.startedAt ? ` · ${formatTime(item.startedAt)}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`text-[11px] ${jobClass(item.status)}`}>{jobLabel(item.status, t)}</span>
                    <span className="text-[11px] text-honey-400">{t('airdrop.viewDetail')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {detailOpen && job ? (
        <Modal
          title={t('airdrop.detail')}
          onClose={() => setDetailOpen(false)}
          className="max-h-[85vh] max-w-5xl overflow-y-auto"
        >
          <div className="mt-3 space-y-3">
            <p className="text-xs text-ink-400">
              {job.symbol} · {t('airdrop.jobCount', { count: job.total })} · {job.amountText}
              {' · '}
              {t('airdrop.detailFrom', { from: shorten(job.fromAddress) })}
              {job.startedAt ? ` · ${formatTime(job.startedAt)}` : ''}
            </p>
            <p className={`text-xs ${jobClass(job.status)}`}>{jobLabel(job.status, t)}</p>
            {!itemPage || itemPage.jobId !== job.id ? (
              <p className="text-sm text-ink-400">{t('common.loading')}</p>
            ) : itemPage.items.length > 0 ? (
              <>
                <ItemTable
                  items={itemPage.items}
                  symbol={job.symbol}
                  network={network}
                  running={running || busy}
                  onRetry={(item) =>
                    void run(async () => {
                      const next = await hdAirdropApi.retry({ jobId: job.id, itemIds: [item.id] })
                      setJob(next)
                    })
                  }
                />
                <Pager page={page} pageCount={pageCount} total={itemPage.total} onPage={setPage} />
              </>
            ) : (
              <p className="text-sm text-ink-400">{t('airdrop.noRows')}</p>
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function ItemTable({
  items,
  symbol,
  network,
  running,
  onRetry,
}: {
  items: HdAirdropItem[]
  symbol: string
  network: ReturnType<typeof currentNetworkOf>
  running: boolean
  onRetry: (item: HdAirdropItem) => void
}) {
  const t = useT()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-ink-500">
          <tr>
            <th className="py-2 pr-3 font-medium">{t('hd.colIndex')}</th>
            <th className="py-2 pr-3 font-medium">{t('hd.colAddress')}</th>
            <th className="py-2 pr-3 font-medium">{t('airdrop.colName')}</th>
            <th className="py-2 pr-3 font-medium">{t('airdrop.colAmount')}</th>
            <th className="py-2 pr-3 font-medium">{t('airdrop.colStatus')}</th>
            <th className="py-2 pr-3 font-medium">{t('airdrop.colTx')}</th>
            <th className="py-2 font-medium">{t('hd.colAction')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const url = item.explorerUrl || (item.txid && network ? txExplorerUrl(network, item.txid) : null)
            const retryable = item.status === 'failed' || item.status === 'queued'
            return (
              <tr key={item.id} className="border-t border-ink-800 align-top">
                <td className="py-2 pr-3 text-ink-300">{item.addressIndex}</td>
                <td className="py-2 pr-3">
                  <AccountAddress
                    address={item.toAddress}
                    explorerUrl={network ? addressExplorerUrl(network, item.toAddress) : null}
                  />
                </td>
                <td className="py-2 pr-3 text-ink-300">{item.toName || '—'}</td>
                <td className="py-2 pr-3 text-ink-200">
                  {formatAmount(item.amount)} {symbol}
                </td>
                <td className={`py-2 pr-3 ${itemClass(item.status)}`}>
                  {itemLabel(item.status, t)}
                  {item.attemptCount > 1 ? ` · ${t('airdrop.attempts', { count: item.attemptCount })}` : ''}
                  {item.error ? <span className="mt-0.5 block max-w-xs text-[10px] text-red-300">{item.error}</span> : null}
                </td>
                <td className="py-2 pr-3">
                  {item.txid ? <AccountAddress label="" address={item.txid} explorerUrl={url} /> : <span className="text-ink-600">—</span>}
                </td>
                <td className="py-2">
                  {retryable ? (
                    <Button variant="ghost" className="px-2 py-1 text-xs" disabled={running} onClick={() => onRetry(item)}>
                      {t('airdrop.retry')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
    onPage(Math.min(pageCount, Math.max(1, next)))
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
      <span>
        {t('hd.pageRange', {
          from: (page - 1) * PAGE_SIZE + 1,
          to: Math.min(page * PAGE_SIZE, total),
          total,
        })}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40" disabled={page <= 1} onClick={() => go(page - 1)}>
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
