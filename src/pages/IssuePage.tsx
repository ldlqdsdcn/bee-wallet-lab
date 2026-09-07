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
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { addressExplorerUrl, explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'

const SUPPLY_PRESETS = [
  { label: '10 亿', value: '1000000000' },
  { label: '1 亿', value: '100000000' },
  { label: '1000 万', value: '10000000' },
]

function statusLabel(status: IssuedTokenRecord['status']): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'failed') return '失败'
  return '待确认'
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
  const [preview, setPreview] = useState<TokenIssuePreview | null>(null)
  const [result, setResult] = useState<TokenIssueResult | null>(null)
  const [issues, setIssues] = useState<IssuedTokenRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const evm = network?.walletType === 'web3'

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
  }, [networkPk])

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
    if (!evm) return []
    return accounts.filter((item) => item.walletType === 'web3')
  }, [accounts, evm])

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
        <h1 className="text-lg font-semibold text-ink-200">发行代币</h1>
        <p className="mt-1 text-xs text-ink-500">
          {network ? network.networkName : '请先在侧栏选择网络'}
          {' · 固定总量 ERC-20，一次性铸给当前账户'}
        </p>
      </div>

      <Alert>{error}</Alert>

      <Card title={`已部署 · ${issues.length}`}>
        {issues.length === 0 ? (
          <p className="text-sm text-ink-400">
            当前网络还没有通过本页部署过的代币。部署确认后会出现在这里，包含合约地址和发行总量。
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
                          {item.name}（{item.symbol}）
                        </span>
                        <span className={`text-[10px] ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                        <span className="text-[10px] text-ink-600">{item.decimals} 位精度</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        总量 {formatAmount(item.supply)} {item.symbol}
                        {item.createdAt ? ` · ${formatTime(item.createdAt)}` : ''}
                      </p>
                      {item.contractAddress ? (
                        <div className="mt-1">
                          <AccountAddress label="合约" address={item.contractAddress} explorerUrl={contractUrl} />
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-ink-500">合约地址确认中…</p>
                      )}
                      <div className="mt-1">
                        <AccountAddress label="交易" address={item.txid} explorerUrl={txUrl} />
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
                          转账
                        </Button>
                      ) : null}
                      {txUrl ? (
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}
                        >
                          详情
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

      {!evm ? (
        <Card title="当前网络不支持">
          <p className="text-sm text-ink-400">发行 ERC-20 需要 EVM 网络，例如 Ethereum、BSC、Base、Sepolia。</p>
          <Button className="mt-3" variant="ghost" onClick={openPicker}>
            切换网络
          </Button>
        </Card>
      ) : (
        <Card title="代币参数">
          <div className="space-y-3">
            <Select
              label="发行账户"
              hint="合约部署后，全部代币会打到这个地址"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {filteredAccounts.length === 0 ? (
                <option value="">当前钱包没有 EVM 账户</option>
              ) : (
                filteredAccounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || 'EVM'} · {shorten(item.address, 8, 6)}
                  </option>
                ))
              )}
            </Select>
            <Field
              label="代币名称"
              placeholder="例如 Bee Token"
              value={name}
              maxLength={64}
              onChange={(e) => {
                setName(e.target.value)
                setPreview(null)
              }}
            />
            <Field
              label="代币符号"
              placeholder="例如 BEE"
              value={symbol}
              maxLength={16}
              className="uppercase"
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase())
                setPreview(null)
              }}
            />
            <Field
              label="精度（decimals）"
              type="number"
              min={0}
              max={18}
              value={decimals}
              hint="常用 18。总量按这个精度换算成最小单位后写入合约。"
              onChange={(e) => {
                setDecimals(e.target.value)
                setPreview(null)
              }}
            />
            <div>
              <Field
                label="发行总量"
                value={supply}
                hint="默认 10 亿枚。全部一次铸给发行账户，之后不能再增发。"
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
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            {preview ? (
              <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  {preview.name}（{preview.symbol}）· {formatAmount(preview.supply)} 枚 · {preview.decimals} 位精度
                </p>
                <p>接收地址 {shorten(preview.from)}</p>
                <p>预估 Gas {preview.feeText}</p>
                {preview.warnings.map((item) => (
                  <p key={item} className="text-honey-400">
                    {item}
                  </p>
                ))}
              </div>
            ) : null}

            {result ? (
              <div className="space-y-2 rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2">
                <p className="text-xs text-honey-400">
                  {result.transaction.status === 'confirmed'
                    ? contractAddress
                      ? '部署已确认，代币已写入本地目录'
                      : '交易已确认'
                    : result.transaction.status === 'failed'
                      ? '部署失败'
                      : '已广播，正在等待合约地址…'}
                </p>
                <p className="sensitive break-all font-mono text-[11px] text-ink-300">{result.txid}</p>
                {contractAddress ? (
                  <p className="sensitive break-all font-mono text-[11px] text-ink-200">{contractAddress}</p>
                ) : null}
                {result.token ? (
                  <p className="text-[11px] text-ink-400">
                    已加入代币目录：{result.token.name} / {result.token.symbol}。到资产总览刷新即可看到余额。
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {result.explorerUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(result.explorerUrl!, explorerTabTitle(result.explorerUrl!))}
                    >
                      查看交易
                    </Button>
                  ) : null}
                  {contractUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(contractUrl, explorerTabTitle(contractUrl))}
                    >
                      查看合约
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
                      去资产总览
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
                    const next = await tokenApi.submit(preview.draftId)
                    setResult(next)
                    setPreview(null)
                  })
                }
              >
                签名并部署
              </Button>
            </div>

            {!account ? (
              <p className="text-xs text-ink-500">当前钱包没有 EVM 账户，请先到「钱包与账户」派生。</p>
            ) : null}
          </div>
        </Card>
      )}
    </div>
  )
}
