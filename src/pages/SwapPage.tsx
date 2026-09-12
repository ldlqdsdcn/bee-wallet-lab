import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AccountRecord, SwapHistoryItem, SwapQuote, TokenRecord, TronEnergyFeeMode } from '@shared/types'
import { accountApi, catalogApi, swapApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { TokenSelect } from '../components/TokenSelect'
import { explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, shorten, walletTypeLabel } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useVaultStore } from '../store/vaultStore'
import { useT } from '../i18n'

const SLIPPAGE_OPTIONS = [50, 100, 200]

function networkSupportsSwap(walletType?: string, networkScope?: string, chainId?: string): boolean {
  if (walletType === 'tron') return networkScope === 'mainnet'
  if (walletType !== 'web3' || !chainId) return false
  const id = /^0x/i.test(chainId) ? Number.parseInt(chainId, 16) : Number(chainId)
  return id === 1 || id === 56 || id === 42161
}

export default function SwapPage() {
  const t = useT()
  const navigate = useNavigate()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const baseUrl = useVaultStore((s) => s.settings?.baseUrl ?? '')
  const openExplorer = useBrowserStore((s) => s.open)

  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [accountId, setAccountId] = useState('')
  const [sellTokenPk, setSellTokenPk] = useState('')
  const [buyTokenPk, setBuyTokenPk] = useState('')
  const [amount, setAmount] = useState('')
  const [slippageBps, setSlippageBps] = useState(100)
  const [energyFeeMode, setEnergyFeeMode] = useState<TronEnergyFeeMode>('rent')
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [history, setHistory] = useState<SwapHistoryItem[]>([])
  const [result, setResult] = useState<{ txid: string; explorerUrl: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const supported = networkSupportsSwap(network?.walletType, network?.networkScope, network?.chainId)
  const catalogReady = Boolean(baseUrl.trim())
  const filteredAccounts = useMemo(() => {
    if (!network) return []
    return accounts.filter((item) => item.walletType === network.walletType)
  }, [accounts, network])

  useEffect(() => {
    if (!currentWalletId) {
      setAccounts([])
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
  }, [currentWalletId])

  useEffect(() => {
    if (accountId && filteredAccounts.some((item) => item.id === accountId)) return
    setAccountId(filteredAccounts[0]?.id ?? '')
  }, [filteredAccounts, accountId])

  useEffect(() => {
    if (!networkPk) {
      setTokens([])
      setSellTokenPk('')
      setBuyTokenPk('')
      return
    }
    let alive = true
    void catalogApi
      .tokens(networkPk)
      .then((list) => {
        if (!alive) return
        setTokens(list)
        setSellTokenPk((pk) => (list.find((item) => item.id === pk) ? pk : list.find((item) => !item.isToken)?.id ?? list[0]?.id ?? ''))
        setBuyTokenPk((pk) => {
          if (list.find((item) => item.id === pk)) return pk
          const sell = list.find((item) => !item.isToken)?.id ?? list[0]?.id
          return list.find((item) => item.id !== sell && item.isToken)?.id ?? list.find((item) => item.id !== sell)?.id ?? ''
        })
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [networkPk])

  useEffect(() => {
    setQuote(null)
    setResult(null)
  }, [networkPk, accountId, sellTokenPk, buyTokenPk, amount, slippageBps])

  useEffect(() => {
    if (!supported || !catalogReady || !accountId || !networkPk) {
      setHistory([])
      return
    }
    let alive = true
    void swapApi
      .list(accountId, networkPk)
      .then((rows) => {
        if (alive) setHistory(rows)
      })
      .catch(() => {
        if (alive) setHistory([])
      })
    return () => {
      alive = false
    }
  }, [supported, catalogReady, accountId, networkPk, result?.txid])

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
    setSellTokenPk(buyTokenPk)
    setBuyTokenPk(sellTokenPk)
    setQuote(null)
  }

  const txUrl = result?.explorerUrl || (network && result?.txid ? txExplorerUrl(network, result.txid) : null)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('swap.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">{t('swap.hint')}</p>
      </div>
      <Alert>{error}</Alert>

      {!supported ? (
        <Card>
          <p className="text-sm text-ink-300">{t('swap.needNetwork')}</p>
          <Button className="mt-3" onClick={openPicker}>
            {t('swap.switchNetwork')}
          </Button>
        </Card>
      ) : null}

      {supported && !catalogReady ? (
        <Card>
          <p className="text-sm text-ink-300">{t('swap.needCatalog')}</p>
          <Button className="mt-3" onClick={() => navigate('/settings')}>
            {t('swap.openSettings')}
          </Button>
        </Card>
      ) : null}

      {supported && catalogReady ? (
        <Card title={t('swap.form')}>
          <div className="space-y-3">
            <Select label={t('common.account')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {filteredAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label || walletTypeLabel(item.walletType)} · {shorten(item.address, 8, 6)}
                </option>
              ))}
            </Select>
            <TokenSelect label={t('swap.sell')} tokens={tokens} value={sellTokenPk} onChange={setSellTokenPk} />
            <div className="flex justify-center">
              <Button variant="ghost" className="px-3 py-1 text-xs" onClick={flip}>
                {t('swap.flip')}
              </Button>
            </div>
            <TokenSelect label={t('swap.buy')} tokens={tokens} value={buyTokenPk} onChange={setBuyTokenPk} />
            <Field label={t('swap.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Select
              label={t('swap.slippage')}
              value={String(slippageBps)}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
            >
              {SLIPPAGE_OPTIONS.map((bps) => (
                <option key={bps} value={bps}>
                  {bps / 100}%
                </option>
              ))}
            </Select>

            {quote ? (
              <div className="space-y-2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {t('swap.receive', {
                    amount: formatAmount(quote.buyAmount),
                    symbol: quote.buySymbol,
                    min: formatAmount(quote.minBuyAmount),
                  })}
                </p>
                <p>{t('swap.feeText', { fee: quote.feeText })}</p>
                {quote.allowanceNeeded ? <p className="text-honey-400">{t('swap.needApprove')}</p> : null}
                {quote.energy?.needed ? (
                  <div className="space-y-2 pt-1">
                    <p>
                      {t('swap.energyCompare', {
                        rent: quote.energy.rentTrx ?? '—',
                        burn: quote.energy.burnTrx || '—',
                      })}
                      {quote.energy.saveTrx && quote.energy.cheaper && quote.energy.cheaper !== 'same' ? (
                        <span className="ml-1 text-honey-400">
                          · {t('swap.energySave', { trx: formatAmount(quote.energy.saveTrx) })}
                        </span>
                      ) : null}
                    </p>
                    <p>
                      {t('swap.energyTimeCompare')}
                      <span className="ml-1 text-honey-400">· {t('swap.energyFaster')}</span>
                    </p>
                    <label className="flex items-start gap-2 text-ink-300">
                      <input
                        type="radio"
                        className="mt-0.5"
                        checked={energyFeeMode === 'rent'}
                        disabled={!quote.energy.rentTrx || busy}
                        onChange={() => setEnergyFeeMode('rent')}
                      />
                      <span>{t('swap.energyRent', { trx: quote.energy.rentTrx ?? '—', time: t('swap.energyRentTime') })}</span>
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
                        {t('swap.energyBurn', { trx: quote.energy.burnTrx || '—', time: t('swap.energyBurnTime') })}
                        <span className="ml-1 text-honey-400">{t('swap.energyFaster')}</span>
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
                <p className="text-xs text-honey-400">{t('swap.submitted')}</p>
                <p className="break-all font-mono text-[11px] text-ink-300">{result.txid}</p>
                {txUrl ? (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}>
                    {t('swap.openExplorer')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy || !accountId || !sellTokenPk || !buyTokenPk || !amount}
                onClick={() =>
                  void run(async () => {
                    setResult(null)
                    const next = await swapApi.quote({
                      accountId,
                      networkPk,
                      sellTokenPk,
                      buyTokenPk,
                      sellAmount: amount,
                      slippageBps,
                    })
                    setQuote(next)
                    if (next.energy?.needed) setEnergyFeeMode(next.energy.rentTrx ? 'rent' : 'burn')
                  })
                }
              >
                {t('swap.quote')}
              </Button>
              <Button
                disabled={busy || !quote}
                onClick={() =>
                  void run(async () => {
                    if (!quote) return
                    const receipt = await swapApi.submit({
                      accountId,
                      networkPk,
                      sellTokenPk,
                      buyTokenPk,
                      sellAmount: amount,
                      slippageBps,
                      energyFeeMode: quote.energy?.needed ? energyFeeMode : undefined,
                    })
                    setResult({ txid: receipt.txid, explorerUrl: receipt.explorerUrl })
                    setQuote(null)
                  })
                }
              >
                {busy && quote?.energy?.needed && energyFeeMode === 'rent' ? t('swap.waitingEnergy') : t('swap.submit')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {history.length ? (
        <Card title={t('swap.history')}>
          <div className="space-y-2">
            {history.map((item) => (
              <div key={item.id} className="rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {item.status} · {item.sellAmount || '—'} → {item.buyAmount || '—'}
                </p>
                {item.txHash ? <p className="break-all font-mono text-[11px] text-ink-500">{item.txHash}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
