import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import { IPC_EVENT } from '@shared/ipc'
import type { AccountRecord, BroadcastResult, FeeLevel, TokenRecord, TransferPreview } from '@shared/types'
import { accountApi, catalogApi, on, transferApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import AddressBookPicker from '../components/AddressBookPicker'
import { TokenSelect } from '../components/TokenSelect'
import { explorerTabTitle } from '../lib/explorer'
import { formatAmount, shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'

interface NavState {
  tokenPk?: string
  accountId?: string
}

export default function TransferPage() {
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
          <h1 className="text-lg font-semibold text-ink-200">收款与转账</h1>
          <p className="mt-1 text-xs text-ink-500">
            {network ? network.networkName : '请先在侧栏选择网络'}
            {' · 只显示当前网络的账户和币种'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'receive' ? 'primary' : 'ghost'} onClick={() => setTab('receive')}>
            收款
          </Button>
          <Button variant={tab === 'send' ? 'primary' : 'ghost'} onClick={() => setTab('send')}>
            转账
          </Button>
        </div>
      </div>

      <Select label="账户" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {filteredAccounts.length === 0 ? (
          <option value="">当前网络没有可用账户</option>
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
        <Card title="收款">
          {!account ? (
            <p className="text-sm text-ink-400">当前网络没有可用账户，请先到「钱包与账户」派生。</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {qr ? <img src={qr} alt="收款二维码" className="rounded-xl" /> : null}
              <p className="sensitive break-all text-center text-sm text-ink-200">{account.address}</p>
              <Button
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(account.address)}
              >
                复制地址
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card title="转账">
          <div className="space-y-3">
            <TokenSelect tokens={tokens} value={tokenPk} onChange={setTokenPk} />
            {tokens.length === 0 ? (
              <p className="text-xs text-ink-500">当前网络还没有可转账的币种。可到「代币维护」添加 ERC-20。</p>
            ) : (
              <p className="text-[11px] text-ink-600">当前网络 {tokens.length} 个币种，点上方列表切换。</p>
            )}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink-400">收款地址</span>
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
                placeholder="粘贴或从地址簿选择"
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Field
              label={`金额${token ? ` (${token.symbol})` : ''}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Select
              label="费率"
              value={feeLevel}
              onChange={(e) => setFeeLevel(e.target.value as FeeLevel)}
            >
              <option value="low">慢</option>
              <option value="medium">标准</option>
              <option value="high">快</option>
              <option value="custom">自定义</option>
            </Select>
            {feeLevel === 'custom' ? (
              <Field
                label={
                  network?.walletType === 'bitcoin'
                    ? 'sat/vB'
                    : network?.walletType === 'solana'
                      ? '优先费（lamports，仅作展示）'
                      : 'maxFeePerGas (gwei)'
                }
                value={customFeeRate}
                onChange={(e) => setCustomFeeRate(e.target.value)}
              />
            ) : null}

            {preview ? (
              <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  支付 {formatAmount(preview.amount)} {preview.symbol} → {shorten(preview.to)}
                </p>
                <p>手续费 {preview.feeText}</p>
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
                    ? '交易已确认'
                    : receipt.transaction.status === 'failed'
                      ? '交易失败'
                      : '已广播，正在确认…'}
                </p>
                <p className="sensitive break-all font-mono text-[11px] text-ink-300">{receipt.txid}</p>
                {receipt.explorerUrl ? (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => openExplorer(receipt.explorerUrl!, explorerTabTitle(receipt.explorerUrl!))}
                  >
                    在浏览器中查看
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
                    setPreview(
                      await transferApi.preview({
                        accountId,
                        networkPk,
                        tokenPk,
                        to,
                        amount,
                        feeLevel,
                        customFeeRate: customFeeRate || undefined,
                      }),
                    )
                  })
                }
              >
                预览
              </Button>
              <Button
                disabled={busy || !preview}
                onClick={() =>
                  void run(async () => {
                    if (!preview) return
                    const result = await transferApi.submit(preview.draftId)
                    setReceipt(result)
                    setPreview(null)
                  })
                }
              >
                签名并广播
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
