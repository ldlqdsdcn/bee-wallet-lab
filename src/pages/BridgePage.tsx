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
import { accountApi, bridgeApi, catalogApi, portfolioApi } from '../lib/bridge'
import { useAccountBalances } from '../lib/accountBalances'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { TokenSelect } from '../components/TokenSelect'
import { explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, fromMinor, shorten, walletTypeLabel } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useVaultStore } from '../store/vaultStore'
import { useT, type MessageKey } from '../i18n'

const SLIPPAGE_OPTIONS = [50, 100, 200]
const BTC_STABLE_SYMBOLS = new Set(['USDT', 'USDC'])
const EVM_NATIVE_BRIDGE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const TRON_NATIVE_BRIDGE = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const CHAIN_LABEL: Record<number, string> = {
  0: 'Bitcoin',
  1: 'Ethereum',
  56: 'BSC',
  42161: 'Arbitrum',
  195: 'Tron',
}

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

/** 跨链按链识别，不按目录行。两条以太坊记录算同一条，不能互跨。 */
function bridgeChainKey(network?: NetworkRecord | null): string | null {
  if (!network) return null
  if (network.walletType === 'bitcoin' && network.networkScope === 'mainnet') return '0'
  if (network.walletType === 'tron' && network.networkScope === 'mainnet') return '195'
  if (network.walletType !== 'web3') return null
  const raw = network.chainId.trim()
  const id = /^0x/i.test(raw) ? Number.parseInt(raw, 16) : Number(raw)
  return id === 1 || id === 56 || id === 42161 ? String(id) : null
}

function sameBridgeChain(a?: NetworkRecord | null, b?: NetworkRecord | null): boolean {
  const left = bridgeChainKey(a)
  const right = bridgeChainKey(b)
  return left != null && left === right
}

function filterBridgeTokens(tokens: TokenRecord[], network: NetworkRecord | null, pairIsBtc: boolean): TokenRecord[] {
  if (!network) return []
  if (isBtcNetwork(network)) return tokens.filter((item) => !item.isToken)
  if (!pairIsBtc) return tokens
  return tokens.filter((item) => !item.isToken || BTC_STABLE_SYMBOLS.has(item.symbol.toUpperCase()))
}

function bridgePhase(status?: string | null): 'filled' | 'failed' | 'pending' {
  const value = (status ?? '').trim().toUpperCase()
  if (value === 'FILLED' || value === 'SUCCESS' || value === 'COMPLETED' || value === 'CONFIRMED') return 'filled'
  if (value === 'FA' || value === 'FAILED' || value === 'REFUNDED' || value === 'REVERT') return 'failed'
  return 'pending'
}

function quoteNetworkFee(
  quote: BridgeQuote,
  selected: BridgeQuote['options'][number] | undefined,
  energyFeeMode: TronEnergyFeeMode,
): string {
  if (selected?.networkFeeText) return selected.networkFeeText
  if (quote.networkFeeText) return quote.networkFeeText
  if (quote.energy?.needed) {
    const trx =
      energyFeeMode === 'rent' && quote.energy.rentTrx ? quote.energy.rentTrx : quote.energy.burnTrx || quote.energy.rentTrx
    return trx ? `${trx} TRX` : ''
  }
  return ''
}

function formatBridgeTime(value: string): string {
  if (!value) return ''
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'))
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString()
}

function isBridgeNativeToken(address: string, chainId: number): boolean {
  const value = address.trim()
  if (!value || value === '0' || /^0x0+$/i.test(value)) return true
  if (chainId === 0) return value.toUpperCase() === 'BTC'
  if (chainId === 195) return value === TRON_NATIVE_BRIDGE
  return value.toLowerCase() === EVM_NATIVE_BRIDGE
}

function chainName(chainId: number, networks: NetworkRecord[]): string {
  const match = networks.find((item) => bridgeChainKey(item) === String(chainId))
  return match?.networkName || CHAIN_LABEL[chainId] || String(chainId)
}

function formatBridgeHistoryAmount(
  raw: string,
  tokenAddress: string,
  chainId: number,
  tokensByChain: Map<number, TokenRecord[]>,
): string {
  if (!raw) return '—'
  const tokens = tokensByChain.get(chainId) ?? []
  const token = isBridgeNativeToken(tokenAddress, chainId)
    ? tokens.find((item) => !item.isToken)
    : tokens.find((item) => item.contractAddress?.toLowerCase() === tokenAddress.toLowerCase())
  if (token) return `${formatAmount(fromMinor(raw, token.decimals))} ${token.symbol}`
  const fallback = chainId === 0 ? 8 : chainId === 195 ? 6 : 18
  return fromMinor(raw, fallback)
}

function bridgeHistoryStatus(
  item: Pick<BridgeHistoryItem, 'status' | 'destTxHash'>,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const value = item.status.trim().toUpperCase()
  if (value === 'QUOTE') return t('bridge.statusQuote')
  const phase = item.destTxHash && bridgePhase(value) !== 'failed' ? 'filled' : bridgePhase(value)
  if (phase === 'filled') return t('bridge.statusFilled')
  if (phase === 'failed') return t('bridge.statusFailed')
  if (value === 'SUBMITTED' || value === 'PENDING' || value === 'BRIDGE' || value === 'ORIGIN_OK') {
    return t('bridge.statusSubmitted')
  }
  return item.status || '—'
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
  const [tokenCatalog, setTokenCatalog] = useState<Record<string, TokenRecord[]>>({})
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
    feeText: string | null
  } | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<'quote' | 'submit' | null>(null)
  const busy = pending != null
  const originBalances = useAccountBalances(originAccountId, originPk)
  const destBalances = useAccountBalances(destAccountId, destPk)
  const statusText = bridgeStatus?.status || result?.status
  const phase = result && (result.destTxHash || bridgeStatus?.destTxHash) && bridgePhase(statusText) === 'pending'
    ? 'filled'
    : bridgePhase(statusText)

  const catalogReady = Boolean(baseUrl.trim())
  const originNetwork = supportedNetworks.find((item) => item.id === originPk) ?? null
  const destNetwork = supportedNetworks.find((item) => item.id === destPk) ?? null
  const destChoices = useMemo(
    () => supportedNetworks.filter((item) => !sameBridgeChain(originNetwork, item)),
    [supportedNetworks, originNetwork],
  )
  const pairIsBtc = isBtcNetwork(originNetwork) || isBtcNetwork(destNetwork)
  const sameChain = sameBridgeChain(originNetwork, destNetwork)

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
  const sellBalance = originBalances.of(sellTokenPk)
  const sellSymbol = sellTokens.find((item) => item.id === sellTokenPk)?.symbol ?? ''
  const tokensByChain = useMemo(() => {
    const map = new Map<number, TokenRecord[]>()
    for (const network of supportedNetworks) {
      const key = Number(bridgeChainKey(network))
      if (!Number.isFinite(key)) continue
      const list =
        tokenCatalog[network.id] ??
        (network.id === originPk ? originTokens : network.id === destPk ? destTokens : [])
      if (list.length) map.set(key, list)
    }
    return map
  }, [supportedNetworks, tokenCatalog, originPk, destPk, originTokens, destTokens])

  useEffect(() => {
    if (originPk && supportedNetworks.some((item) => item.id === originPk)) return
    const preferred = current && networkSupportsBridge(current) ? current.id : supportedNetworks[0]?.id ?? ''
    setOriginPk(preferred)
  }, [supportedNetworks, originPk, current])

  useEffect(() => {
    if (destPk && destChoices.some((item) => item.id === destPk)) return
    setDestPk(destChoices[0]?.id ?? '')
  }, [destChoices, destPk])

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
    if (!supportedNetworks.length) {
      setTokenCatalog({})
      return
    }
    let alive = true
    void Promise.all(
      supportedNetworks.map((network) =>
        catalogApi
          .tokens(network.id)
          .then((list) => [network.id, list] as const)
          .catch(() => [network.id, []] as const),
      ),
    ).then((entries) => {
      if (alive) setTokenCatalog(Object.fromEntries(entries))
    })
    return () => {
      alive = false
    }
  }, [supportedNetworks])

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
    const pending = history.filter((item) => {
      const status = item.status.trim().toUpperCase()
      return Boolean(item.id && item.txHash) && status !== 'QUOTE' && bridgePhase(status) === 'pending' && !item.destTxHash
    })
    if (!pending.length) return
    let alive = true
    const tick = async () => {
      const updates = await Promise.all(
        pending.slice(0, 5).map(async (item) => {
          try {
            const next = await bridgeApi.status(item.id)
            return { id: item.id, next }
          } catch {
            return null
          }
        }),
      )
      if (!alive) return
      setHistory((rows) =>
        rows.map((row) => {
          const hit = updates.find((item) => item && item.id === row.id)
          if (!hit) return row
          const destTxHash = hit.next.destTxHash || row.destTxHash
          const status =
            destTxHash && bridgePhase(hit.next.status) !== 'failed' ? 'FILLED' : hit.next.status || row.status
          return { ...row, status, destTxHash }
        }),
      )
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 8_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [history.map((item) => `${item.id}:${item.status}:${item.destTxHash ?? ''}`).join('|')])

  useEffect(() => {
    if (!result?.txid) return
    originBalances.reload()
  }, [result?.txid])

  useEffect(() => {
    if (phase !== 'filled' || !result?.txid) return
    originBalances.reload()
    destBalances.reload()
    if (originPk) void portfolioApi.snapshot(originPk)
    if (destPk) void portfolioApi.snapshot(destPk)
    const later = window.setTimeout(() => {
      originBalances.reload()
      destBalances.reload()
      if (originPk) void portfolioApi.snapshot(originPk)
      if (destPk) void portfolioApi.snapshot(destPk)
    }, 4000)
    return () => window.clearTimeout(later)
  }, [phase, result?.txid, originPk, destPk])

  useEffect(() => {
    if (!result?.quoteId) return
    const terminal = new Set(['FILLED', 'SUCCESS', 'COMPLETED', 'FA', 'FAILED', 'REFUNDED'])
    if (bridgeStatus && (terminal.has(bridgeStatus.status.toUpperCase()) || bridgeStatus.destTxHash)) return
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

  const run = async (kind: 'quote' | 'submit', fn: () => Promise<void>) => {
    setPending(kind)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
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
  const destHash = result?.destTxHash || bridgeStatus?.destTxHash || ''
  const destTxUrl = destNetwork && destHash ? txExplorerUrl(destNetwork, destHash) : null

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
                {destChoices.map((item) => (
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

            <TokenSelect
              label={t('bridge.sell')}
              tokens={sellTokens}
              value={sellTokenPk}
              onChange={setSellTokenPk}
              balances={originBalances.byToken}
            />
            <TokenSelect
              label={t('bridge.buy')}
              tokens={buyTokens}
              value={buyTokenPk}
              onChange={setBuyTokenPk}
              balances={destBalances.byToken}
            />
            {pairIsBtc ? <p className="text-xs text-ink-500">{t('bridge.btcOnly')}</p> : null}
            <div>
              <Field label={t('bridge.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="mt-1 flex items-center justify-between text-[11px] text-ink-500">
                <span>
                  {originBalances.loading && sellBalance == null
                    ? t('common.loading')
                    : t('common.balance', {
                        amount: sellBalance != null ? formatAmount(sellBalance) : '—',
                        symbol: sellSymbol,
                      })}
                </span>
                <button
                  type="button"
                  className="text-honey-400 disabled:text-ink-600"
                  disabled={!sellBalance || Number(sellBalance) <= 0}
                  onClick={() => setAmount(sellBalance ?? '')}
                >
                  {t('common.max')}
                </button>
              </div>
            </div>
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
                            {item.feeText ? ` · ${t('bridge.feeText', { fee: item.feeText })}` : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {quote.provider ? <p>{t('bridge.provider', { name: quote.provider })}</p> : null}
                {quoteNetworkFee(quote, selected, energyFeeMode) ? (
                  <p className="text-sm text-ink-200">
                    {t('bridge.networkFee', { fee: quoteNetworkFee(quote, selected, energyFeeMode) })}
                  </p>
                ) : (
                  <p className="text-sm text-ink-400">{t('bridge.networkFeePending')}</p>
                )}
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
              <div
                className={
                  phase === 'failed'
                    ? 'space-y-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2'
                    : phase === 'filled'
                      ? 'space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2'
                      : 'space-y-2 rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2'
                }
              >
                <p
                  className={`text-sm font-semibold ${
                    phase === 'failed' ? 'text-red-300' : phase === 'filled' ? 'text-emerald-300' : 'text-honey-400'
                  }`}
                >
                  {phase === 'failed' ? t('bridge.failed') : phase === 'filled' ? t('bridge.filled') : t('bridge.submitted')}
                </p>
                <p className="text-xs text-ink-400">
                  {t('bridge.status', {
                    status:
                      phase === 'failed'
                        ? t('bridge.statusFailed')
                        : phase === 'filled'
                          ? t('bridge.statusFilled')
                          : t('bridge.statusSubmitted'),
                  })}
                </p>
                <p className="break-all font-mono text-[11px] text-ink-300">{result.txid}</p>
                <p className="text-sm text-ink-200">
                  {result.feeText
                    ? t('bridge.gasUsed', { fee: result.feeText })
                    : t('bridge.networkFeePending')}
                </p>
                {destHash ? (
                  <p className="break-all font-mono text-[11px] text-ink-400">{t('bridge.destHash', { hash: destHash })}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {txUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}
                    >
                      {t('bridge.openExplorer')}
                    </Button>
                  ) : null}
                  {destTxUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(destTxUrl, explorerTabTitle(destTxUrl))}
                    >
                      {t('bridge.openDestExplorer')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                loading={pending === 'quote'}
                disabled={busy || sameChain || !originAccountId || !sellTokenPk || !buyTokenPk || !amount}
                onClick={() =>
                  void run('quote', async () => {
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
                {pending === 'quote' ? t('bridge.quoting') : t('bridge.quote')}
              </Button>
              <Button
                loading={pending === 'submit'}
                disabled={busy || !quote || !quote.liquidityAvailable || !selected}
                onClick={() =>
                  void run('submit', async () => {
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
                      feeText: receipt.feeText || selected.networkFeeText || quote.networkFeeText,
                    })
                    setQuote(null)
                    originBalances.reload()
                    destBalances.reload()
                  })
                }
              >
                {pending === 'submit'
                  ? quote?.energy?.needed && energyFeeMode === 'rent'
                    ? t('bridge.waitingEnergy')
                    : t('bridge.submitting')
                  : t('bridge.submit')}
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
                  {bridgeHistoryStatus(item, t)} · {chainName(item.originChainId, supportedNetworks)} →{' '}
                  {chainName(item.destinationChainId, supportedNetworks)}
                </p>
                <p className="text-ink-300">
                  {t('bridge.historyAmount', {
                    sell: formatBridgeHistoryAmount(item.sellAmount, item.sellToken, item.originChainId, tokensByChain),
                    buy: formatBridgeHistoryAmount(item.buyAmount, item.buyToken, item.destinationChainId, tokensByChain),
                  })}
                </p>
                {item.created ? <p>{formatBridgeTime(item.created)}</p> : null}
                {item.originAddress ? (
                  <p className="break-all font-mono text-[11px] text-ink-300">
                    {t('bridge.historyFrom', { address: item.originAddress })}
                  </p>
                ) : null}
                {item.destinationAddress ? (
                  <p className="break-all font-mono text-[11px] text-ink-300">
                    {t('bridge.historyTo', { address: item.destinationAddress })}
                  </p>
                ) : null}
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
