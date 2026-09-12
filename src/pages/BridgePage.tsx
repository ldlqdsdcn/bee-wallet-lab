import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type {
  AccountRecord,
  BridgeHistoryItem,
  BridgeQuote,
  BridgeSortBy,
  BridgeStatus,
  NetworkRecord,
  TokenRecord,
  TronEnergyFeeMode,
} from '@shared/types'
import { accountApi, bridgeApi, catalogApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { TokenSelect } from '../components/TokenSelect'
import { explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, shorten, walletTypeLabel } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useVaultStore } from '../store/vaultStore'
import { useT, type MessageKey } from '../i18n'

const SLIPPAGE_OPTIONS = [50, 100, 200]
const BTC_STABLE_SYMBOLS = new Set(['USDT', 'USDC'])

function networkSupportsBridge(network?: NetworkRecord | null): boolean {
  if (!network) return false
  if (network.walletType === 'bitcoin' || network.walletType === 'tron') return network.networkScope === 'mainnet'
  if (network.walletType !== 'web3') return false
  const raw = network.chainId.trim()
  const id = /^0x/i.test(raw) ? Number.parseInt(raw, 16) : Number(raw)
  return id === 1 || id === 56 || id === 42161
}

function isBtcNetwork(network?: NetworkRecord | null): boolean {
  return network?.walletType === 'bitcoin' && network.networkScope === 'mainnet'
}

function filterBridgeTokens(tokens: TokenRecord[], network: NetworkRecord | null, pairIsBtc: boolean): TokenRecord[] {
  if (!network) return []
  if (isBtcNetwork(network)) return tokens.filter((item) => !item.isToken)
  if (!pairIsBtc) return tokens
  return tokens.filter((item) => !item.isToken || BTC_STABLE_SYMBOLS.has(item.symbol.toUpperCase()))
}

function formatEta(
  seconds: number | null,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return t('bridge.etaUnknown')
  if (seconds < 60) return t('bridge.etaSeconds', { n: Math.ceil(seconds) })
  if (seconds < 3600) return t('bridge.etaMinutes', { n: Math.ceil(seconds / 60) })
  return t('bridge.etaHours', { n: (seconds / 3600).toFixed(1) })
}

export default function BridgePage() {
  const t = useT()
  const navigate = useNavigate()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const currentPk = useNetworkStore((s) => s.currentPk)
  const current = currentNetworkOf({ networks, currentPk })
  const baseUrl = useVaultStore((s) => s.settings?.baseUrl ?? '')
  const openExplorer = useBrowserStore((s) => s.open)

  const supportedNetworks = useMemo(() => networks.filter((item) => networkSupportsBridge(item)), [networks])

  const [originPk, setOriginPk] = useState('')
  const [destPk, setDestPk] = useState('')
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [originTokens, setOriginTokens] = useState<TokenRecord[]>([])
  const [destTokens, setDestTokens] = useState<TokenRecord[]>([])
  const [originAccountId, setOriginAccountId] = useState('')
  const [destAccountId, setDestAccountId] = useState('')
  const [destAddress, setDestAddress] = useState('')
  const [sellTokenPk, setSellTokenPk] = useState('')
  const [buyTokenPk, setBuyTokenPk] = useState('')
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)
  const [sortQuotesBy, setSortQuotesBy] = useState<BridgeSortBy>('price')
  const [quoteIndex, setQuoteIndex] = useState(0)
  const [energyFeeMode, setEnergyFeeMode] = useState<TronEnergyFeeMode>('rent')
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [history, setHistory] = useState<BridgeHistoryItem[]>([])
  const [result, setResult] = useState<{
    quoteId: string
    txid: string
    explorerUrl: string | null
    status: string
    destTxHash: string | null
  } | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const catalogReady = Boolean(baseUrl.trim())
  const originNetwork = supportedNetworks.find((item) => item.id === originPk) ?? null
  const destNetwork = supportedNetworks.find((item) => item.id === destPk) ?? null
  const pairIsBtc = isBtcNetwork(originNetwork) || isBtcNetwork(destNetwork)
  const sameChain = Boolean(originPk && destPk && originPk === destPk)

  const originAccounts = useMemo(() => {
    if (!originNetwork) return []
    return accounts.filter((item) => item.walletType === originNetwork.walletType)
  }, [accounts, originNetwork])

  const destAccounts = useMemo(() => {
    if (!destNetwork) return []
    return accounts.filter((item) => item.walletType === destNetwork.walletType)
  }, [accounts, destNetwork])

  const sellTokens = useMemo(
    () => filterBridgeTokens(originTokens, originNetwork, pairIsBtc),
    [originTokens, originNetwork, pairIsBtc],
  )
  const buyTokens = useMemo(
    () => filterBridgeTokens(destTokens, destNetwork, pairIsBtc),
    [destTokens, destNetwork, pairIsBtc],
  )

  useEffect(() => {
    if (originPk && supportedNetworks.some((item) => item.id === originPk)) return
    const preferred = current && networkSupportsBridge(current) ? current.id : supportedNetworks[0]?.id ?? ''
    setOriginPk(preferred)
  }, [supportedNetworks, originPk, current])

  useEffect(() => {
    if (destPk && destPk !== originPk && supportedNetworks.some((item) => item.id === destPk)) return
    const next = supportedNetworks.find((item) => item.id !== (originPk || current?.id))
    setDestPk(next?.id ?? '')
  }, [supportedNetworks, destPk, originPk, current])

  useEffect(() => {
    if (!currentWalletId) {
      setAccounts([])
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
  }, [currentWalletId])

  useEffect(() => {
    if (originAccountId && originAccounts.some((item) => item.id === originAccountId)) return
    setOriginAccountId(originAccounts[0]?.id ?? '')
  }, [originAccounts, originAccountId])

  useEffect(() => {
    if (destAccountId && destAccounts.some((item) => item.id === destAccountId)) return
    setDestAccountId(destAccounts[0]?.id ?? '')
  }, [destAccounts, destAccountId])

  useEffect(() => {
    if (!originPk) {
      setOriginTokens([])
      setSellTokenPk('')
      return
    }
    let alive = true
    void catalogApi
      .tokens(originPk)
      .then((list) => {
        if (!alive) return
        setOriginTokens(list)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [originPk])

  useEffect(() => {
    if (!destPk) {
      setDestTokens([])
      setBuyTokenPk('')
      return
    }
    let alive = true
    void catalogApi
      .tokens(destPk)
      .then((list) => {
        if (!alive) return
        setDestTokens(list)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [destPk])

  useEffect(() => {
    setSellTokenPk((pk) => (sellTokens.find((item) => item.id === pk) ? pk : sellTokens.find((item) => !item.isToken)?.id ?? sellTokens[0]?.id ?? ''))
  }, [sellTokens])

  useEffect(() => {
    setBuyTokenPk((pk) => {
      if (buyTokens.find((item) => item.id === pk)) return pk
      return buyTokens.find((item) => item.isToken)?.id ?? buyTokens[0]?.id ?? ''
    })
  }, [buyTokens])

  useEffect(() => {
    setQuote(null)
    setResult(null)
    setBridgeStatus(null)
    setQuoteIndex(0)
  }, [originPk, destPk, originAccountId, destAccountId, destAddress, sellTokenPk, buyTokenPk, amount, slippageBps, sortQuotesBy])

  useEffect(() => {
    if (!catalogReady || !originAccountId || !originPk) {
      setHistory([])
      return
    }
    let alive = true
    void bridgeApi
      .list(originAccountId, originPk)
      .then((rows) => {
        if (alive) setHistory(rows)
      })
      .catch(() => {
        if (alive) setHistory([])
      })
    return () => {
      alive = false
    }
  }, [catalogReady, originAccountId, originPk, result?.txid])

  useEffect(() => {
    if (!result?.quoteId) return
    const terminal = new Set(['FILLED', 'FA'])
    if (bridgeStatus && terminal.has(bridgeStatus.status)) return
    let alive = true
    const tick = async () => {
      try {
        const next = await bridgeApi.status(result.quoteId)
        if (!alive) return
        setBridgeStatus(next)
        if (next.destTxHash) {
          setResult((prev) => (prev ? { ...prev, destTxHash: next.destTxHash, status: next.status } : prev))
        }
      } catch {
        /* 轮询失败不打断页面 */
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 8_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [result?.quoteId, bridgeStatus?.status])

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

  const flip = () => {
    const nextOrigin = destPk
    const nextDest = originPk
    const nextSell = buyTokenPk
    const nextBuy = sellTokenPk
    setOriginPk(nextOrigin)
    setDestPk(nextDest)
    setSellTokenPk(nextSell)
    setBuyTokenPk(nextBuy)
    setQuote(null)
  }

  const selected = quote?.options[quoteIndex] ?? quote?.options[0]
  const originForExplorer = originNetwork
  const txUrl = result?.explorerUrl || (originForExplorer && result?.txid ? txExplorerUrl(originForExplorer, result.txid) : null)
  const statusText = bridgeStatus?.status || result?.status

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('bridge.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">{t('bridge.hint')}</p>
      </div>
      <Alert>{error}</Alert>

      {!catalogReady ? (
        <Card>
          <p className="text-sm text-ink-300">{t('bridge.needCatalog')}</p>
          <Button className="mt-3" onClick={() => navigate('/settings')}>
            {t('bridge.openSettings')}
          </Button>
        </Card>
      ) : (
        <Card title={t('bridge.form')}>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={t('bridge.origin')} value={originPk} onChange={(e) => setOriginPk(e.target.value)}>
                {supportedNetworks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.networkName}
                  </option>
                ))}
              </Select>
              <Select label={t('bridge.dest')} value={destPk} onChange={(e) => setDestPk(e.target.value)}>
                {supportedNetworks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.networkName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-center">
              <Button variant="ghost" className="px-3 py-1 text-xs" onClick={flip}>
                {t('bridge.flip')}
              </Button>
            </div>
            {sameChain ? <p className="text-xs text-honey-400">{t('bridge.sameChain')}</p> : null}

            <Select label={t('bridge.originAccount')} value={originAccountId} onChange={(e) => setOriginAccountId(e.target.value)}>
              {originAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label || walletTypeLabel(item.walletType)} · {shorten(item.address, 8, 6)}
                </option>
              ))}
            </Select>
            {!originAccounts.length ? <p className="text-xs text-honey-400">{t('bridge.noOriginAccount')}</p> : null}

            <Select label={t('bridge.destAccount')} value={destAccountId} onChange={(e) => setDestAccountId(e.target.value)}>
              {destAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label || walletTypeLabel(item.walletType)} · {shorten(item.address, 8, 6)}
                </option>
              ))}
            </Select>
            {!destAccounts.length ? <p className="text-xs text-honey-400">{t('bridge.noDestAccount')}</p> : null}
            <Field
              label={t('bridge.destAddress')}
              value={destAddress}
              placeholder={t('bridge.destAddressPh')}
              onChange={(e) => setDestAddress(e.target.value)}
            />

            <TokenSelect label={t('bridge.sell')} tokens={sellTokens} value={sellTokenPk} onChange={setSellTokenPk} />
            <TokenSelect label={t('bridge.buy')} tokens={buyTokens} value={buyTokenPk} onChange={setBuyTokenPk} />
            {pairIsBtc ? <p className="text-xs text-ink-500">{t('bridge.btcOnly')}</p> : null}
            <Field label={t('bridge.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={t('bridge.slippage')}
                value={String(slippageBps)}
                onChange={(e) => setSlippageBps(Number(e.target.value))}
              >
                {SLIPPAGE_OPTIONS.map((bps) => (
                  <option key={bps} value={bps}>
                    {bps / 100}%
                  </option>
                ))}
              </Select>
              <Select
                label={t('bridge.sort')}
                value={sortQuotesBy}
                onChange={(e) => setSortQuotesBy(e.target.value as BridgeSortBy)}
              >
                <option value="price">{t('bridge.sortPrice')}</option>
                <option value="speed">{t('bridge.sortSpeed')}</option>
              </Select>
            </div>

            {quote ? (
              <div className="space-y-2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                {!quote.liquidityAvailable || !quote.options.length ? (
                  <p className="text-honey-400">{t('bridge.noLiquidity')}</p>
                ) : (
                  <div className="space-y-2">
                    <p>{t('bridge.pickQuote')}</p>
                    {quote.options.map((item) => (
                      <label key={item.index} className="flex items-start gap-2 text-ink-300">
                        <input
                          type="radio"
                          className="mt-0.5"
                          checked={quoteIndex === item.index}
                          disabled={busy}
                          onChange={() => setQuoteIndex(item.index)}
                        />
                        <span>
                          {t('bridge.receive', {
                            amount: formatAmount(item.buyAmount),
                            symbol: quote.buySymbol,
                            min: formatAmount(item.minBuyAmount),
                          })}
                          <span className="ml-1 text-ink-500">
                            · {t('bridge.eta', { eta: formatEta(item.estimatedTimeSeconds, t) })}
                            · {t('bridge.feeText', { fee: item.feeText })}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {quote.provider ? <p>{t('bridge.provider', { name: quote.provider })}</p> : null}
                {selected?.allowanceNeeded ? <p className="text-honey-400">{t('bridge.needApprove')}</p> : null}
                {quote.energy?.needed ? (
                  <div className="space-y-2 pt-1">
                    <p>
                      {t('bridge.energyCompare', {
                        rent: quote.energy.rentTrx ?? '—',
                        burn: quote.energy.burnTrx || '—',
                      })}
                      {quote.energy.saveTrx && quote.energy.cheaper && quote.energy.cheaper !== 'same' ? (
                        <span className="ml-1 text-honey-400">
                          · {t('bridge.energySave', { trx: formatAmount(quote.energy.saveTrx) })}
                        </span>
                      ) : null}
                    </p>
                    <p>
                      {t('bridge.energyTimeCompare')}
                      <span className="ml-1 text-honey-400">· {t('bridge.energyFaster')}</span>
                    </p>
                    <label className="flex items-start gap-2 text-ink-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        checked={energyFeeMode === 'rent'}
                        disabled={!quote.energy.rentTrx || busy}
                        onChange={() => setEnergyFeeMode('rent')}
                      />
                      <span>
                        {t('bridge.energyRent', { trx: quote.energy.rentTrx ?? '—', time: t('bridge.energyRentTime') })}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-ink-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        checked={energyFeeMode === 'burn'}
                        disabled={busy}
                        onChange={() => setEnergyFeeMode('burn')}
                      />
                      <span>
                        {t('bridge.energyBurn', { trx: quote.energy.burnTrx || '—', time: t('bridge.energyBurnTime') })}
                        <span className="ml-1 text-honey-400">{t('bridge.energyFaster')}</span>
                      </span>
                    </label>
                  </div>
                ) : null}
                {quote.warnings.map((item) => (
                  <p key={item} className="text-honey-400">
                    {item}
                  </p>
                ))}
              </div>
            ) : null}

            {result ? (
              <div className="space-y-2 rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2">
                <p className="text-xs text-honey-400">{t('bridge.submitted')}</p>
                <p className="text-xs text-ink-400">{t('bridge.status', { status: statusText || 'SUBMITTED' })}</p>
                <p className="break-all font-mono text-[11px] text-ink-300">{result.txid}</p>
                {result.destTxHash || bridgeStatus?.destTxHash ? (
                  <p className="break-all font-mono text-[11px] text-ink-400">
                    {t('bridge.destHash', { hash: result.destTxHash || bridgeStatus?.destTxHash || '' })}
                  </p>
                ) : null}
                {txUrl ? (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}>
                    {t('bridge.openExplorer')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy || sameChain || !originAccountId || !sellTokenPk || !buyTokenPk || !amount}
                onClick={() =>
                  void run(async () => {
                    setResult(null)
                    const next = await bridgeApi.quote({
                      originAccountId,
                      originNetworkPk: originPk,
                      destNetworkPk: destPk,
                      destAccountId: destAccountId || undefined,
                      destAddress: destAddress.trim() || undefined,
                      sellTokenPk,
                      buyTokenPk,
                      sellAmount: amount,
                      slippageBps,
                      sortQuotesBy,
                    })
                    setQuote(next)
                    setQuoteIndex(next.options[0]?.index ?? 0)
                    if (next.energy?.needed) setEnergyFeeMode(next.energy.rentTrx ? 'rent' : 'burn')
                  })
                }
              >
                {t('bridge.quote')}
              </Button>
              <Button
                disabled={busy || !quote || !quote.liquidityAvailable || !selected}
                onClick={() =>
                  void run(async () => {
                    if (!quote || !selected) return
                    const receipt = await bridgeApi.submit({
                      originAccountId,
                      originNetworkPk: originPk,
                      destNetworkPk: destPk,
                      destAccountId: destAccountId || undefined,
                      destAddress: destAddress.trim() || undefined,
                      sellTokenPk,
                      buyTokenPk,
                      sellAmount: amount,
                      slippageBps,
                      sortQuotesBy,
                      quoteIndex: selected.index,
                      energyFeeMode: quote.energy?.needed ? energyFeeMode : undefined,
                    })
                    setResult({
                      quoteId: receipt.quoteId,
                      txid: receipt.txid,
                      explorerUrl: receipt.explorerUrl,
                      status: receipt.status,
                      destTxHash: receipt.destTxHash,
                    })
                    setQuote(null)
                  })
                }
              >
                {busy && quote?.energy?.needed && energyFeeMode === 'rent' ? t('bridge.waitingEnergy') : t('bridge.submit')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {history.length ? (
        <Card title={t('bridge.history')}>
          <div className="space-y-2">
            {history.map((item) => (
              <div key={item.id} className="rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {item.status} · {item.originChainId} → {item.destinationChainId} · {item.sellAmount || '—'} → {item.buyAmount || '—'}
                </p>
                {item.txHash ? <p className="break-all font-mono text-[11px] text-ink-500">{item.txHash}</p> : null}
                {item.destTxHash ? <p className="break-all font-mono text-[11px] text-ink-500">{item.destTxHash}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
