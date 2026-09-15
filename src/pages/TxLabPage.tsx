import { useEffect, useMemo, useState } from 'react'
import { IPC_EVENT } from '@shared/ipc'
import type {
  AccountRecord,
  BroadcastResult,
  FeeLevel,
  TokenRecord,
  TransferPreview,
  TxLabDecoded,
  TxLabRawFormat,
  TxLabSigned,
} from '@shared/types'
import { accountApi, catalogApi, on, transferApi, txLabApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select, TextArea } from '../components/ui'
import AddressBookPicker from '../components/AddressBookPicker'
import { TokenSelect } from '../components/TokenSelect'
import { explorerTabTitle } from '../lib/explorer'
import { formatAmount, shorten, walletTypeLabel } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useT } from '../i18n'

const RAW_LABEL: Record<TxLabRawFormat, string> = {
  hex: 'Hex',
  base64: 'Base64',
  json: 'JSON',
}

export default function TxLabPage() {
  const t = useT()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const openExplorer = useBrowserStore((s) => s.open)

  const [tab, setTab] = useState<'build' | 'decode'>('build')
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [tokenPk, setTokenPk] = useState('')
  const [accountId, setAccountId] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [feeLevel, setFeeLevel] = useState<FeeLevel>('medium')
  const [customFeeRate, setCustomFeeRate] = useState('')
  const [customPriorityFee, setCustomPriorityFee] = useState('')
  const [gasLimit, setGasLimit] = useState('')
  const [nonce, setNonce] = useState('')
  const [feeLimit, setFeeLimit] = useState('')
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [signed, setSigned] = useState<TxLabSigned | null>(null)
  const [receipt, setReceipt] = useState<BroadcastResult | null>(null)
  const [paste, setPaste] = useState('')
  const [decoded, setDecoded] = useState<TxLabDecoded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

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
    setSigned(null)
    setReceipt(null)
    setDecoded(null)
    setTo('')
    setAmount('')
    setPaste('')
    setGasLimit('')
    setNonce('')
    setFeeLimit('')
    setCustomFeeRate('')
    setCustomPriorityFee('')
  }, [networkPk])

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
    const txid = receipt?.txid
    if (!txid) return
    return on(IPC_EVENT.transactionUpdated, (payload) => {
      const record = (payload as { record?: BroadcastResult['transaction'] }).record
      if (!record || record.txid !== txid) return
      setReceipt((prev) =>
        prev ? { ...prev, transaction: record, explorerUrl: record.explorerUrl ?? prev.explorerUrl } : prev,
      )
    })
  }, [receipt?.txid])

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

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied((prev) => (prev === label ? null : prev)), 1500)
  }

  const decodeHint =
    network?.walletType === 'solana'
      ? t('txLab.hintSol')
      : network?.walletType === 'tron'
        ? t('txLab.hintTron')
        : t('txLab.hintHex')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">{t('txLab.title')}</h1>
          <p className="mt-1 text-xs text-ink-500">
            {network ? `${network.networkName} · ${walletTypeLabel(network.walletType)}` : t('transfer.needNetwork')}
            {' · '}
            {t('txLab.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'build' ? 'primary' : 'ghost'} onClick={() => setTab('build')}>
            {t('txLab.build')}
          </Button>
          <Button variant={tab === 'decode' ? 'primary' : 'ghost'} onClick={() => setTab('decode')}>
            {t('txLab.decode')}
          </Button>
        </div>
      </div>

      <Alert>{error}</Alert>

      {tab === 'build' ? (
        <Card title="Transaction Builder">
          <div className="space-y-3">
            <Select label={t('txLab.from')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
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
            <TokenSelect tokens={tokens} value={tokenPk} onChange={setTokenPk} />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink-400">{t('transfer.to')}</span>
                {network ? (
                  <AddressBookPicker
                    walletType={network.walletType}
                    networkScope={network.networkScope}
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
            <Select label={t('common.fee')} value={feeLevel} onChange={(e) => setFeeLevel(e.target.value as FeeLevel)}>
              <option value="low">{t('common.slow')}</option>
              <option value="medium">{t('common.standard')}</option>
              <option value="high">{t('common.fast')}</option>
              <option value="custom">{t('common.custom')}</option>
            </Select>
            {feeLevel === 'custom' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={
                    network?.walletType === 'bitcoin'
                      ? t('transfer.customBtc')
                      : network?.walletType === 'solana'
                        ? t('txLab.priorityShow')
                        : network?.walletType === 'tron'
                          ? t('txLab.customTron')
                          : t('transfer.customEvm')
                  }
                  value={customFeeRate}
                  onChange={(e) => setCustomFeeRate(e.target.value)}
                />
                {network?.walletType === 'web3' ? (
                  <Field
                    label="maxPriorityFeePerGas (gwei)"
                    value={customPriorityFee}
                    onChange={(e) => setCustomPriorityFee(e.target.value)}
                  />
                ) : null}
              </div>
            ) : null}

            {network?.walletType === 'web3' || network?.walletType === 'tron' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {network.walletType === 'web3' ? (
                  <>
                    <Field label={t('txLab.nonce')} value={nonce} onChange={(e) => setNonce(e.target.value)} />
                    <Field label={t('txLab.gas')} value={gasLimit} onChange={(e) => setGasLimit(e.target.value)} />
                  </>
                ) : (
                  <Field
                    label="feeLimit (TRX)"
                    hint={t('txLab.feeLimitHint')}
                    value={feeLimit}
                    onChange={(e) => setFeeLimit(e.target.value)}
                  />
                )}
              </div>
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
                {Object.entries(preview.detail).map(([key, value]) =>
                  value ? (
                    <p key={key} className="break-all">
                      {key}: {value}
                    </p>
                  ) : null,
                )}
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
                disabled={busy || !accountId || !tokenPk || !to || !amount || !networkPk}
                onClick={() =>
                  void run(async () => {
                    setSigned(null)
                    setReceipt(null)
                    setPreview(
                      await transferApi.preview({
                        accountId,
                        networkPk,
                        tokenPk,
                        to,
                        amount,
                        feeLevel,
                        customFeeRate: customFeeRate || undefined,
                        customPriorityFee: customPriorityFee || undefined,
                        gasLimit: gasLimit || undefined,
                        nonce: nonce ? Number(nonce) : undefined,
                        feeLimit: feeLimit || undefined,
                      }),
                    )
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
                    setReceipt(null)
                    setSigned(await txLabApi.sign(preview.draftId))
                    setPreview(null)
                  })
                }
              >
                {t('txLab.signOnly')}
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card title="Transaction Decoder">
          <div className="space-y-3">
            <TextArea
              label={t('txLab.raw')}
              className="sensitive min-h-36 font-mono text-xs"
              hint={decodeHint}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <Button
              disabled={busy || !networkPk || !paste.trim()}
              onClick={() =>
                void run(async () => {
                  setReceipt(null)
                  setDecoded(await txLabApi.decode({ networkPk, raw: paste }))
                })
              }
            >
              {t('txLab.parse')}
            </Button>
          </div>
        </Card>
      )}

      {tab === 'build' && signed ? (
        <RawCard
          title={t('txLab.signed')}
          raw={signed.raw}
          format={signed.rawFormat}
          txid={signed.txid}
          signed
          fields={signed.decoded}
          copied={copied}
          onCopy={copy}
        />
      ) : null}

      {tab === 'decode' && decoded ? (
        <RawCard
          title={decoded.signed ? t('txLab.decodedSigned') : t('txLab.decodedUnsigned')}
          raw={decoded.raw}
          format={decoded.rawFormat}
          txid={decoded.txid}
          signed={decoded.signed}
          fields={decoded.fields}
          warnings={decoded.warnings}
          copied={copied}
          onCopy={copy}
        />
      ) : null}

      {(tab === 'build' && signed) || (tab === 'decode' && decoded?.signed) ? (
        <Card title="Broadcast">
          <div className="space-y-3">
            <p className="text-xs text-ink-500">{t('txLab.broadcastHint')}</p>
            <Button
              disabled={busy || !networkPk || Boolean(receipt)}
              onClick={() =>
                void run(async () => {
                  if (tab === 'build' && signed) {
                    setReceipt(
                      await txLabApi.broadcast({
                        networkPk: signed.networkPk,
                        raw: signed.raw,
                        accountId: signed.accountId,
                        from: signed.from,
                        to: signed.to,
                        amount: signed.amount,
                        symbol: signed.symbol,
                        tokenPk,
                        fee: signed.feeText,
                      }),
                    )
                    return
                  }
                  if (tab === 'decode' && decoded) {
                    setReceipt(
                      await txLabApi.broadcast({
                        networkPk,
                        raw: decoded.raw,
                        accountId: accountId || undefined,
                        from: decoded.fields.from || decoded.fields.feePayer || account?.address,
                        to: decoded.fields.to,
                        amount: decoded.fields.amount || decoded.fields.value,
                      }),
                    )
                  }
                })
              }
            >
              {t('common.broadcast')}
            </Button>
          </div>
        </Card>
      ) : null}

      {receipt ? (
        <Card title={t('txLab.result')}>
          <div className="space-y-2">
            <p className="text-xs text-honey-400">
              {receipt.transaction.status === 'confirmed'
                ? t('transfer.confirmed')
                : receipt.transaction.status === 'failed'
                  ? t('transfer.failed')
                  : t('transfer.pending')}
            </p>
            <p className="sensitive break-all font-mono text-[11px] text-ink-300">{receipt.txid}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy('txid', receipt.txid)}>
                {copied === 'txid' ? t('common.copied') : t('txLab.copyHash')}
              </Button>
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
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function RawCard({
  title,
  raw,
  format,
  txid,
  signed,
  fields,
  warnings,
  copied,
  onCopy,
}: {
  title: string
  raw: string
  format: TxLabRawFormat
  txid: string | null
  signed: boolean
  fields: Record<string, string>
  warnings?: string[]
  copied: string | null
  onCopy: (label: string, value: string) => void
}) {
  const t = useT()
  return (
    <Card title={title} action={<span className="text-[11px] text-ink-500">{RAW_LABEL[format]}</span>}>
      <div className="space-y-3">
        {txid ? (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-400">Tx Hash</p>
            <p className="sensitive break-all font-mono text-[11px] text-ink-300">{txid}</p>
            <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => void onCopy('hash', txid)}>
              {copied === 'hash' ? t('common.copied') : t('txLab.copyHash')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-500">{signed ? t('txLab.hasSig') : t('txLab.noHash')}</p>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-ink-400">Raw Transaction</p>
          <pre className="sensitive max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-900 px-3 py-2 font-mono text-[11px] text-ink-300">
            {raw}
          </pre>
          <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => void onCopy('raw', raw)}>
            {copied === 'raw' ? t('common.copied') : t('txLab.copyRaw')}
          </Button>
        </div>
        <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
          {Object.entries(fields).map(([key, value]) =>
            value ? (
              <p key={key} className="break-all">
                {key}: {value}
              </p>
            ) : null,
          )}
        </div>
        {warnings?.map((item) => (
          <p key={item} className="text-xs text-honey-400">
            {item}
          </p>
        ))}
      </div>
    </Card>
  )
}
