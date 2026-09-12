import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import { IPC_EVENT } from '@shared/ipc'
import type {
  AccountRecord,
  BroadcastResult,
  FeeLevel,
  TokenRecord,
  TransferPreview,
  TronEnergyFeeMode,
} from '@shared/types'
import { accountApi, catalogApi, on, transferApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import AddressBookPicker from '../components/AddressBookPicker'
import { TokenSelect } from '../components/TokenSelect'
import { explorerTabTitle } from '../lib/explorer'
import { formatAmount, shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useT } from '../i18n'

interface NavState {
  tokenPk?: string
  accountId?: string
}

export default function TransferPage() {
  const t = useT()
  const location = useLocation()
  const nav = (location.state ?? {}) as NavState
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const [tab, setTab] = useState<'receive' | 'send'>('send')
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [tokenPk, setTokenPk] = useState(nav.tokenPk ?? '')
  const [accountId, setAccountId] = useState(nav.accountId ?? '')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [feeLevel, setFeeLevel] = useState<FeeLevel>('medium')
  const [customFeeRate, setCustomFeeRate] = useState('')
  const [energyFeeMode, setEnergyFeeMode] = useState<TronEnergyFeeMode>('burn')
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [receipt, setReceipt] = useState<BroadcastResult | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const openExplorer = useBrowserStore((s) => s.open)

  const account = accounts.find((item) => item.id === accountId)
  const token = tokens.find((item) => item.id === tokenPk)

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
    setTokens([])
    void catalogApi
      .tokens(networkPk)
      .then((list) => {
        if (!alive) return
        setTokens(list)
        setTokenPk((pk) => (list.find((item) => item.id === pk) ? pk : list[0]?.id ?? ''))
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
    setReceipt(null)
    setTo('')
    setAmount('')
  }, [networkPk])

  useEffect(() => {
    const txid = receipt?.txid
    if (!txid) return
    return on(IPC_EVENT.transactionUpdated, (payload) => {
      const record = (payload as { record?: BroadcastResult['transaction'] }).record
      if (!record || record.txid !== txid) return
      setReceipt((prev) => (prev ? { ...prev, transaction: record, explorerUrl: record.explorerUrl ?? prev.explorerUrl } : prev))
    })
  }, [receipt?.txid])

  const filteredAccounts = useMemo(() => {
    if (!network) return accounts
    return accounts.filter((item) => {
      if (item.walletType !== network.walletType) return false
      if (network.walletType === 'bitcoin') return item.networkScope === network.networkScope
      return true
    })
  }, [accounts, network])

  useEffect(() => {
    if (accountId && filteredAccounts.some((item) => item.id === accountId)) return
    if (filteredAccounts[0]) setAccountId(filteredAccounts[0].id)
    else setAccountId('')
  }, [filteredAccounts, accountId])

  useEffect(() => {
    if (!account?.address) {
      setQr(null)
      return
    }
    void QRCode.toDataURL(account.address, { margin: 1, width: 220, color: { dark: '#11161f', light: '#fff7e6' } }).then(
      setQr,
    )
  }, [account?.address])

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

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('transfer.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {network ? network.networkName : t('transfer.needNetwork')}
            {' · '}
            {t('transfer.networkHint')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'receive' ? 'primary' : 'ghost'} onClick={() => setTab('receive')}>
            {t('transfer.receive')}
          </Button>
          <Button variant={tab === 'send' ? 'primary' : 'ghost'} onClick={() => setTab('send')}>
            {t('transfer.send')}
          </Button>
        </div>
      </div>

      <Select label={t('transfer.account')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {filteredAccounts.length === 0 ? (
          <option value="">{t('transfer.noAccount')}</option>
        ) : (
          filteredAccounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label || item.addressType || item.walletType} · {shorten(item.address, 8, 6)}
            </option>
          ))
        )}
      </Select>

      <Alert>{error}</Alert>

      {tab === 'receive' ? (
        <Card title={t('transfer.receive')}>
          {!account ? (
            <p className="text-sm text-ink-400">{t('transfer.noAccountHint')}</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {qr ? <img src={qr} alt={t('transfer.qrAlt')} className="rounded-xl" /> : null}
              <p className="sensitive break-all text-center text-sm text-ink-200">{account.address}</p>
              <Button
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(account.address)}
              >
                {t('transfer.copyAddress')}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card title={t('transfer.send')}>
          <div className="space-y-3">
            <TokenSelect tokens={tokens} value={tokenPk} onChange={setTokenPk} />
            {tokens.length === 0 ? (
              <p className="text-xs text-ink-500">{t('transfer.noToken')}</p>
            ) : (
              <p className="text-[11px] text-ink-600">{t('transfer.tokenCount', { count: tokens.length })}</p>
            )}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink-400">{t('transfer.to')}</span>
                {network ? (
                  <AddressBookPicker
                    walletType={network.walletType}
                    networkScope={network.networkScope}
                    networkPk={network.id}
                    onSelect={(entry) => setTo(entry.address)}
                  />
                ) : null}
              </div>
              <input
                className="sensitive w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none focus:border-honey-500"
                value={to}
                placeholder={t('transfer.toPlaceholder')}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Field
              label={`${t('common.amount')}${token ? ` (${token.symbol})` : ''}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {network?.walletType !== 'tron' ? (
              <>
                <Select
                  label={t('common.fee')}
                  value={feeLevel}
                  onChange={(e) => setFeeLevel(e.target.value as FeeLevel)}
                >
                  <option value="low">{t('common.slow')}</option>
                  <option value="medium">{t('common.standard')}</option>
                  <option value="high">{t('common.fast')}</option>
                  <option value="custom">{t('common.custom')}</option>
                </Select>
                {feeLevel === 'custom' ? (
                  <Field
                    label={
                      network?.walletType === 'bitcoin'
                        ? t('transfer.customBtc')
                        : network?.walletType === 'solana'
                          ? t('transfer.customSol')
                          : t('transfer.customEvm')
                    }
                    value={customFeeRate}
                    onChange={(e) => setCustomFeeRate(e.target.value)}
                  />
                ) : null}
              </>
            ) : null}

            {preview ? (
              <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {t('transfer.pay', {
                    amount: formatAmount(preview.amount),
                    symbol: preview.symbol,
                    to: shorten(preview.to),
                  })}
                </p>
                <p>{t('transfer.feeText', { fee: preview.feeText })}</p>
                {preview.energy ? (
                  <p>
                    {preview.energy.short
                      ? t('transfer.energyShort', {
                          left: preview.energy.left,
                          required: preview.energy.required,
                        })
                      : t('transfer.energyOk', { left: preview.energy.left, required: preview.energy.required })}
                  </p>
                ) : null}
                {preview.energy?.short ? (
                  <div className="mt-2 space-y-2">
                    <div className="space-y-0.5 text-ink-300">
                      {preview.energy.quote ? (
                        <p>
                          {t('transfer.energyCompare', {
                            rent: formatAmount(preview.energy.quote.priceTrx),
                            burn: formatAmount(preview.energy.burnTrx),
                          })}
                          {preview.energy.saveTrx && preview.energy.cheaper && preview.energy.cheaper !== 'same' ? (
                            <span className="ml-1 text-honey-400">
                              · {t('transfer.energySave', { trx: formatAmount(preview.energy.saveTrx) })}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      <p>
                        {t('transfer.energyTimeCompare', {
                          rent: t('transfer.energyRentTime'),
                          burn: t('transfer.energyBurnTime'),
                        })}
                        <span className="ml-1 text-honey-400">· {t('transfer.energyFaster')}</span>
                      </p>
                    </div>
                    <label className="flex items-start gap-2 text-ink-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name="energy-fee"
                        checked={energyFeeMode === 'rent'}
                        disabled={!preview.energy.canRent || busy}
                        onChange={() =>
                          void run(async () => {
                            setEnergyFeeMode('rent')
                            setPreview(
                              await transferApi.preview({
                                accountId,
                                networkPk,
                                tokenPk,
                                to,
                                amount,
                                feeLevel,
                                customFeeRate: customFeeRate || undefined,
                                energyFeeMode: 'rent',
                              }),
                            )
                          })
                        }
                      />
                      <span>
                        {t('transfer.energyRent', {
                          trx: preview.energy.quote?.priceTrx ?? '—',
                          time: t('transfer.energyRentTime'),
                        })}
                        {preview.energy.cheaper === 'rent' ? (
                          <span className="ml-1 text-honey-400">{t('transfer.energySave', { trx: formatAmount(preview.energy.saveTrx) })}</span>
                        ) : null}
                        <span className="mt-0.5 block text-[11px] text-ink-600">{t('transfer.energyRentHint')}</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-ink-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name="energy-fee"
                        checked={energyFeeMode === 'burn'}
                        disabled={busy}
                        onChange={() =>
                          void run(async () => {
                            setEnergyFeeMode('burn')
                            setPreview(
                              await transferApi.preview({
                                accountId,
                                networkPk,
                                tokenPk,
                                to,
                                amount,
                                feeLevel,
                                customFeeRate: customFeeRate || undefined,
                                energyFeeMode: 'burn',
                              }),
                            )
                          })
                        }
                      />
                      <span>
                        {t('transfer.energyBurn', {
                          trx: preview.energy.burnTrx,
                          time: t('transfer.energyBurnTime'),
                        })}
                        {preview.energy.cheaper === 'burn' ? (
                          <span className="ml-1 text-honey-400">{t('transfer.energySave', { trx: formatAmount(preview.energy.saveTrx) })}</span>
                        ) : (
                          <span className="ml-1 text-honey-400">{t('transfer.energyFaster')}</span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-ink-600">{t('transfer.energyBurnHint')}</span>
                      </span>
                    </label>
                    {!preview.energy.canRent && preview.energy.rentReason ? (
                      <p className="text-honey-400">{t('transfer.energyRentUnavailable', { reason: preview.energy.rentReason })}</p>
                    ) : null}
                  </div>
                ) : null}
                {preview.warnings.map((item) => (
                  <p key={item} className="text-honey-400">
                    {item}
                  </p>
                ))}
              </div>
            ) : null}

            {receipt ? (
              <div className="space-y-2 rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2">
                <p className="text-xs text-honey-400">
                  {receipt.transaction.status === 'confirmed'
                    ? t('transfer.confirmed')
                    : receipt.transaction.status === 'failed'
                      ? t('transfer.failed')
                      : t('transfer.pending')}
                </p>
                <p className="sensitive break-all font-mono text-[11px] text-ink-300">{receipt.txid}</p>
                {receipt.explorerUrl ? (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => openExplorer(receipt.explorerUrl!, explorerTabTitle(receipt.explorerUrl!))}
                  >
                    {t('transfer.openExplorer')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy || !accountId || !tokenPk || !to || !amount}
                onClick={() =>
                  void run(async () => {
                    setReceipt(null)
                    const next = await transferApi.preview({
                      accountId,
                      networkPk,
                      tokenPk,
                      to,
                      amount,
                      feeLevel,
                      customFeeRate: customFeeRate || undefined,
                      energyFeeMode,
                    })
                    setPreview(next)
                    if (next.energy) setEnergyFeeMode(next.energy.selected)
                  })
                }
              >
                {t('common.preview')}
              </Button>
              <Button
                disabled={busy || !preview}
                onClick={() =>
                  void run(async () => {
                    if (!preview) return
                    const result = await transferApi.submit(
                      preview.draftId,
                      preview.energy?.short ? energyFeeMode : undefined,
                    )
                    setReceipt(result)
                    setPreview(null)
                  })
                }
              >
                {busy && preview?.energy?.short && energyFeeMode === 'rent'
                  ? t('transfer.energyWaiting')
                  : t('transfer.signBroadcast')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
