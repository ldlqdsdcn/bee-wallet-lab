import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import type {
  AccountRecord,
  FeeLevel,
  NetworkRecord,
  TokenRecord,
  TransferPreview,
} from '@shared/types'
import { accountApi, catalogApi, transferApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { NetworkSelect } from '../components/NetworkSelect'
import AddressBookPicker from '../components/AddressBookPicker'
import { formatAmount, shorten } from '../lib/format'
import { useWalletStore } from '../store/walletStore'

interface NavState {
  networkPk?: string
  tokenPk?: string
  accountId?: string
}

export default function TransferPage() {
  const location = useLocation()
  const nav = (location.state ?? {}) as NavState
  const currentWalletId = useWalletStore((s) => s.currentId)
  const [tab, setTab] = useState<'receive' | 'send'>('send')
  const [networks, setNetworks] = useState<NetworkRecord[]>([])
  const [tokens, setTokens] = useState<TokenRecord[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [networkPk, setNetworkPk] = useState(nav.networkPk ?? '')
  const [tokenPk, setTokenPk] = useState(nav.tokenPk ?? '')
  const [accountId, setAccountId] = useState(nav.accountId ?? '')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [feeLevel, setFeeLevel] = useState<FeeLevel>('medium')
  const [customFeeRate, setCustomFeeRate] = useState('')
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [txid, setTxid] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const network = networks.find((item) => item.id === networkPk)
  const account = accounts.find((item) => item.id === accountId)
  const token = tokens.find((item) => item.id === tokenPk)

  useEffect(() => {
    void catalogApi.networks().then((list) => {
      setNetworks(list)
      if (!networkPk && list[0]) setNetworkPk(list[0].id)
    })
    if (!currentWalletId) {
      setAccounts([])
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
  }, [currentWalletId])

  useEffect(() => {
    if (!networkPk) return
    void catalogApi.tokens(networkPk).then((list) => {
      setTokens(list)
      if (!list.find((item) => item.id === tokenPk)) setTokenPk(list[0]?.id ?? '')
    })
  }, [networkPk, tokenPk])

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
        <h1 className="text-lg font-semibold text-ink-200">收款与转账</h1>
        <div className="flex gap-2">
          <Button variant={tab === 'receive' ? 'primary' : 'ghost'} onClick={() => setTab('receive')}>
            收款
          </Button>
          <Button variant={tab === 'send' ? 'primary' : 'ghost'} onClick={() => setTab('send')}>
            转账
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NetworkSelect
          label="网络"
          networks={networks}
          value={networkPk}
          onChange={setNetworkPk}
          className="min-w-0"
        />
        <Select label="账户" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {filteredAccounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label || item.addressType || item.walletType} · {shorten(item.address, 8, 6)}
            </option>
          ))}
        </Select>
      </div>

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
            <Select label="代币" value={tokenPk} onChange={(e) => setTokenPk(e.target.value)}>
              {tokens.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.symbol} {item.isToken ? '' : '(原生)'}
                </option>
              ))}
            </Select>
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

            {txid ? (
              <p className="sensitive break-all text-xs text-honey-400">已广播 {txid}</p>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={busy || !accountId || !tokenPk || !to || !amount}
                onClick={() =>
                  void run(async () => {
                    setTxid(null)
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
                    setTxid(result.txid)
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
