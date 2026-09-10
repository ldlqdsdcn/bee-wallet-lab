import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC_EVENT } from '@shared/ipc'
import type {
  AccountRecord,
  IssuedTokenRecord,
  TokenIssuePreview,
  TokenIssueResult,
  TokenRecord,
} from '@shared/types'
import { accountApi, on, tokenApi } from '../lib/bridge'
import { AccountAddress } from '../components/AccountAddress'
import { Alert, Button, Card, Field, Select, TextArea } from '../components/ui'
import { addressExplorerUrl, explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useT, type MessageKey } from '../i18n'

const SUPPLY_PRESETS: { key: MessageKey; value: string }[] = [
  { key: 'issue.supply1b', value: '1000000000' },
  { key: 'issue.supply100m', value: '100000000' },
  { key: 'issue.supply10m', value: '10000000' },
]

function statusLabel(
  status: IssuedTokenRecord['status'],
  t: ReturnType<typeof useT>,
): string {
  if (status === 'confirmed') return t('issue.statusConfirmed')
  if (status === 'failed') return t('issue.statusFailed')
  return t('issue.statusPending')
}

function statusClass(status: IssuedTokenRecord['status']): string {
  if (status === 'confirmed') return 'text-emerald-400'
  if (status === 'failed') return 'text-red-300'
  return 'text-honey-400'
}

function formatTime(at: number): string {
  if (!at) return ''
  return new Date(at).toLocaleString()
}

export default function IssuePage() {
  const t = useT()
  const navigate = useNavigate()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const openExplorer = useBrowserStore((s) => s.open)

  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [accountId, setAccountId] = useState('')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState('18')
  const [supply, setSupply] = useState('1000000000')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [website, setWebsite] = useState('')
  const [metadataUri, setMetadataUri] = useState('')
  const [copiedJson, setCopiedJson] = useState(false)
  const [preview, setPreview] = useState<TokenIssuePreview | null>(null)
  const [result, setResult] = useState<TokenIssueResult | null>(null)
  const [issues, setIssues] = useState<IssuedTokenRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const evm = network?.walletType === 'web3'
  const solana = network?.walletType === 'solana'
  const canIssue = evm || solana
  const chainLabel = evm ? 'ERC-20' : solana ? 'SPL' : ''

  useEffect(() => {
    if (!currentWalletId) {
      setAccounts([])
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
  }, [currentWalletId])

  useEffect(() => {
    setPreview(null)
    setResult(null)
    setDecimals(network?.walletType === 'solana' ? '9' : '18')
  }, [networkPk, network?.walletType])

  useEffect(() => {
    if (!networkPk) {
      setIssues([])
      return
    }
    let alive = true
    void tokenApi
      .list(networkPk)
      .then((rows) => {
        if (alive) setIssues(rows)
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
    const reload = () => {
      void tokenApi.list(networkPk).then(setIssues).catch(() => undefined)
    }
    const offCatalog = on(IPC_EVENT.catalogUpdated, reload)
    const offTx = on(IPC_EVENT.transactionUpdated, reload)
    return () => {
      offCatalog()
      offTx()
    }
  }, [networkPk])

  const filteredAccounts = useMemo(() => {
    if (!network || !canIssue) return []
    return accounts.filter((item) => item.walletType === network.walletType)
  }, [accounts, network, canIssue])

  useEffect(() => {
    if (accountId && filteredAccounts.some((item) => item.id === accountId)) return
    setAccountId(filteredAccounts[0]?.id ?? '')
  }, [filteredAccounts, accountId])

  useEffect(() => {
    const txid = result?.txid
    if (!txid) return
    return on(IPC_EVENT.transactionUpdated, (payload) => {
      const body = payload as {
        record?: TokenIssueResult['transaction']
        token?: TokenRecord
        contractAddress?: string
        issue?: IssuedTokenRecord
      }
      const record = body.record
      if (record && record.txid !== txid) return
      if (!record && !body.issue) return
      setResult((prev) =>
        prev
          ? {
              ...prev,
              transaction: record ?? prev.transaction,
              explorerUrl: record?.explorerUrl ?? prev.explorerUrl,
              contractAddress: body.contractAddress ?? body.issue?.contractAddress ?? prev.contractAddress,
              token: body.token ?? prev.token,
              issue: body.issue ?? prev.issue,
            }
          : prev,
      )
    })
  }, [result?.txid])

  const account = filteredAccounts.find((item) => item.id === accountId)
  const contractAddress =
    result?.contractAddress ??
    (result && result.transaction.toAddress !== result.transaction.fromAddress ? result.transaction.toAddress : null)
  const contractUrl = network && contractAddress ? addressExplorerUrl(network, contractAddress) : null

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
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('issue.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">
          {network ? network.networkName : t('issue.needNetworkSidebar')}
          {canIssue
            ? ` · ${t('issue.fixedMint', { chain: chainLabel })}`
            : ` · ${t('issue.needEvmSol')}`}
        </p>
      </div>

      <Alert>{error}</Alert>

      <Card title={t('issue.deployed', { count: issues.length })}>
        {issues.length === 0 ? (
          <p className="text-sm text-ink-400">
            {t('issue.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {issues.map((item) => {
              const itemNetwork = networks.find((row) => row.id === item.networkPk) ?? network
              const contractUrl =
                item.contractAddress && itemNetwork ? addressExplorerUrl(itemNetwork, item.contractAddress) : null
              const txUrl = item.explorerUrl || (itemNetwork ? txExplorerUrl(itemNetwork, item.txid) : null)
              return (
                <li key={item.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-[10px] text-honey-400">
                      {item.symbol.slice(0, 3)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-ink-200">
                          {t('issue.nameSymbol', { name: item.name, symbol: item.symbol })}
                        </span>
                        <span className={`text-[10px] ${statusClass(item.status)}`}>{statusLabel(item.status, t)}</span>
                        <span className="text-[10px] text-ink-600">{t('issue.decimalsN', { n: item.decimals })}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {t('issue.supplyLine', { amount: formatAmount(item.supply), symbol: item.symbol })}
                        {item.createdAt ? ` · ${formatTime(item.createdAt)}` : ''}
                      </p>
                      {item.contractAddress ? (
                        <div className="mt-1">
                          <AccountAddress label={t('issue.contract')} address={item.contractAddress} explorerUrl={contractUrl} />
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-ink-500">{t('issue.contractPending')}</p>
                      )}
                      <div className="mt-1">
                        <AccountAddress label={t('issue.tx')} address={item.txid} explorerUrl={txUrl} />
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      {item.tokenPk ? (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() =>
                            navigate('/transfer', {
                              state: { tokenPk: item.tokenPk, accountId: item.accountId },
                            })
                          }
                        >
                          {t('issue.transfer')}
                        </Button>
                      ) : null}
                      {txUrl ? (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}
                        >
                          {t('issue.detail')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {!canIssue ? (
        <Card title={t('issue.unsupported')}>
          <p className="text-sm text-ink-400">
            {t('issue.unsupportedBody')}
          </p>
          <Button className="mt-3" variant="ghost" onClick={openPicker}>
            {t('issue.switchNetwork')}
          </Button>
        </Card>
      ) : (
        <Card title={t('issue.params')}>
          <div className="space-y-3">
            <Select
              label={t('issue.account')}
              hint={solana ? t('issue.accountHintSol') : t('issue.accountHintEvm')}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {filteredAccounts.length === 0 ? (
                <option value="">{solana ? t('issue.noSol') : t('issue.noEvm')}</option>
              ) : (
                filteredAccounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || (solana ? 'Solana' : 'EVM')} · {shorten(item.address, 8, 6)}
                  </option>
                ))
              )}
            </Select>
            <Field
              label={t('issue.tokenName')}
              placeholder={t('issue.tokenNamePh')}
              value={name}
              maxLength={solana ? 32 : 64}
              hint={solana ? t('issue.nameHintSol') : undefined}
              onChange={(e) => {
                setName(e.target.value)
                setPreview(null)
              }}
            />
            <Field
              label={t('issue.tokenSymbol')}
              placeholder={t('issue.tokenSymbolPh')}
              value={symbol}
              maxLength={solana ? 10 : 16}
              className="uppercase"
              hint={solana ? t('issue.symbolHintSol') : undefined}
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase())
                setPreview(null)
              }}
            />
            <Field
              label={t('issue.decimalsLabel')}
              type="number"
              min={0}
              max={solana ? 9 : 18}
              value={decimals}
              hint={solana ? t('issue.decimalsHintSol') : t('issue.decimalsHintEvm')}
              onChange={(e) => {
                setDecimals(e.target.value)
                setPreview(null)
              }}
            />
            <div>
              <Field
                label={t('issue.supplyLabel')}
                value={supply}
                hint={solana ? t('issue.supplyHintSol') : t('issue.supplyHintEvm')}
                onChange={(e) => {
                  setSupply(e.target.value)
                  setPreview(null)
                }}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {SUPPLY_PRESETS.map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    variant={supply === item.value ? 'primary' : 'ghost'}
                    className="px-2 py-1 text-xs"
                    onClick={() => {
                      setSupply(item.value)
                      setPreview(null)
                    }}
                  >
                    {t(item.key)}
                  </Button>
                ))}
              </div>
            </div>

            {solana ? (
              <div className="space-y-3 rounded-lg border border-ink-700 px-3 py-3">
                <p className="text-xs text-ink-400">
                  {t('issue.solMetaHint')}
                </p>
                <TextArea
                  label={t('issue.desc')}
                  placeholder={t('issue.descPh')}
                  maxLength={200}
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value)
                    setPreview(null)
                  }}
                />
                <Field
                  label={t('issue.logo')}
                  placeholder="https://…/logo.png"
                  value={logoUrl}
                  hint={t('issue.logoHint')}
                  onChange={(e) => {
                    setLogoUrl(e.target.value)
                    setPreview(null)
                  }}
                />
                <Field
                  label={t('issue.website')}
                  placeholder="https://example.com"
                  value={website}
                  onChange={(e) => {
                    setWebsite(e.target.value)
                    setPreview(null)
                  }}
                />
                <Field
                  label={t('issue.metaUri')}
                  placeholder="https://…/metadata.json"
                  value={metadataUri}
                  hint={t('issue.metaUriHint')}
                  onChange={(e) => {
                    setMetadataUri(e.target.value)
                    setPreview(null)
                  }}
                />
              </div>
            ) : null}

            {preview ? (
              <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {t('issue.previewLine', {
                    name: preview.name,
                    symbol: preview.symbol,
                    amount: formatAmount(preview.supply),
                    decimals: preview.decimals,
                  })}
                </p>
                <p>{t('issue.receive', { address: shorten(preview.from) })}</p>
                {preview.contractAddress ? <p>Mint {shorten(preview.contractAddress)}</p> : null}
                {preview.metadataUri ? <p className="break-all">{t('issue.metaUri')} {preview.metadataUri}</p> : null}
                <p>{t('issue.estFee', { fee: preview.feeText })}</p>
                {preview.warnings.map((item) => (
                  <p key={item} className="text-honey-400">
                    {item}
                  </p>
                ))}
                {preview.metadataJson ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-300">{t('issue.metaJson')}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => {
                          void navigator.clipboard.writeText(preview.metadataJson ?? '').then(() => {
                            setCopiedJson(true)
                            window.setTimeout(() => setCopiedJson(false), 1500)
                          })
                        }}
                      >
                        {copiedJson ? t('common.copied') : t('common.copy')}
                      </Button>
                    </div>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-ink-950 px-2 py-1 font-mono text-[11px] text-ink-300">
                      {preview.metadataJson}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}

            {result ? (
              <div className="space-y-2 rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2">
                <p className="text-xs text-honey-400">
                  {result.transaction.status === 'confirmed'
                    ? contractAddress
                      ? t('issue.confirmedCatalog')
                      : t('issue.confirmed')
                    : result.transaction.status === 'failed'
                      ? t('issue.failed')
                      : solana
                        ? t('issue.pendingSol')
                        : t('issue.pendingEvm')}
                </p>
                <p className="sensitive break-all font-mono text-[11px] text-ink-300">{result.txid}</p>
                {contractAddress ? (
                  <p className="sensitive break-all font-mono text-[11px] text-ink-200">{contractAddress}</p>
                ) : null}
                {result.token ? (
                  <p className="text-[11px] text-ink-400">
                    {t('issue.inCatalog', { name: result.token.name ?? result.token.symbol, symbol: result.token.symbol })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {result.explorerUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(result.explorerUrl!, explorerTabTitle(result.explorerUrl!))}
                    >
                      {t('issue.viewTx')}
                    </Button>
                  ) : null}
                  {contractUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(contractUrl, explorerTabTitle(contractUrl))}
                    >
                      {solana ? t('issue.viewToken') : t('issue.viewContract')}
                    </Button>
                  ) : null}
                  {result.token ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() =>
                        navigate('/', {
                          state: { tokenPk: result.token?.id, accountId },
                        })
                      }
                    >
                      {t('issue.goHome')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy || !accountId || !name.trim() || !symbol.trim() || !supply.trim()}
                onClick={() =>
                  void run(async () => {
                    setResult(null)
                    setPreview(
                      await tokenApi.preview({
                        accountId,
                        networkPk,
                        name,
                        symbol,
                        decimals: Number(decimals),
                        supply,
                        ...(solana
                          ? {
                              description,
                              logoUrl,
                              website,
                              metadataUri,
                            }
                          : {}),
                      }),
                    )
                  })
                }
              >
                {t('issue.preview')}
              </Button>
              <Button
                disabled={busy || !preview}
                onClick={() =>
                  void run(async () => {
                    if (!preview) return
                    const next = await tokenApi.submit(preview.draftId)
                    setResult(next)
                    setPreview(null)
                  })
                }
              >
                {t('issue.signDeploy')}
              </Button>
            </div>

            {!account ? (
              <p className="text-xs text-ink-500">
                {solana ? t('issue.needSolAccount') : t('issue.needEvmAccount')}
              </p>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  )
}
