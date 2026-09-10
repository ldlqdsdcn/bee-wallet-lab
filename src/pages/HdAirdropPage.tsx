import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { IPC_EVENT } from '@shared/ipc'
import type {
  AccountRecord,
  HdAirdropAmountMode,
  HdAirdropInput,
  HdAirdropItem,
  HdAirdropItemPage,
  HdAirdropItemStatus,
  HdAirdropJob,
  HdAirdropPreview,
  TokenRecord,
} from '@shared/types'
import { accountApi, catalogApi, hdAirdropApi, on } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { TokenSelect } from '../components/TokenSelect'
import { AccountAddress } from '../components/AccountAddress'
import { explorerTabTitle, txExplorerUrl } from '../lib/explorer'
import { formatAmount, shorten } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'

const PAGE_SIZE = 50

function isErc20(token: TokenRecord): boolean {
  if (!token.isToken) return false
  const value = token.contractAddress?.trim() ?? ''
  return Boolean(value && value !== '0' && !/^0x0+$/i.test(value))
}

function jobLabel(status: HdAirdropJob['status']): string {
  if (status === 'running') return '进行中'
  if (status === 'done') return '已完成'
  if (status === 'stopped') return '已停止'
  return '失败'
}

function jobClass(status: HdAirdropJob['status']): string {
  if (status === 'running') return 'text-honey-400'
  if (status === 'done') return 'text-emerald-400'
  if (status === 'stopped') return 'text-ink-400'
  return 'text-red-300'
}

function itemLabel(status: HdAirdropItemStatus): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'pending') return '待确认'
  if (status === 'failed') return '失败'
  if (status === 'queued') return '未发送'
  return '已跳过'
}

function itemClass(status: HdAirdropItemStatus): string {
  if (status === 'confirmed') return 'text-emerald-400'
  if (status === 'pending') return 'text-honey-400'
  if (status === 'failed') return 'text-red-300'
  if (status === 'queued') return 'text-ink-400'
  return 'text-ink-500'
}

function formatEta(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `约 ${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `约 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `约 ${hours} 小时 ${rem} 分钟` : `约 ${hours} 小时`
}

function formatTime(at: number | null): string {
  if (!at) return ''
  return new Date(at).toLocaleString()
}

export default function HdAirdropPage() {
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
  const [tokenPk, setTokenPk] = useState('')
  const [fromIndex, setFromIndex] = useState('1')
  const [toIndex, setToIndex] = useState('20000')
  const [accountIndex, setAccountIndex] = useState('0')
  const [amountMode, setAmountMode] = useState<HdAirdropAmountMode>('fixed')
  const [amount, setAmount] = useState('1000')
  const [amountMin, setAmountMin] = useState('1000')
  const [amountMax, setAmountMax] = useState('2000')
  const [hdCount, setHdCount] = useState(0)
  const [preview, setPreview] = useState<HdAirdropPreview | null>(null)
  const [jobs, setJobs] = useState<HdAirdropJob[]>([])
  const [job, setJob] = useState<HdAirdropJob | null>(null)
  const [itemPage, setItemPage] = useState<HdAirdropItemPage | null>(null)
  const [itemFilter, setItemFilter] = useState<HdAirdropItemStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const evm = network?.walletType === 'web3'
  const erc20s = useMemo(() => tokens.filter(isErc20), [tokens])
  const running = job?.status === 'running'
  const selectedId = job?.id

  const reloadJobs = async (preferId?: string) => {
    if (!currentWalletId) {
      setJobs([])
      return
    }
    const list = await hdAirdropApi.jobs(currentWalletId, networkPk || undefined)
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
      setHdCount(0)
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
    void accountApi
      .hdKeyList({ walletId: currentWalletId, walletType: 'web3' })
      .then((rows) => setHdCount(rows.length))
      .catch(() => setHdCount(0))
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
        const next = list.filter(isErc20)
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
  }, [networkPk, currentWalletId, accountId, tokenPk, fromIndex, toIndex, accountIndex, amountMode, amount, amountMin, amountMax])

  useEffect(() => {
    setPage(1)
    setItemFilter('all')
    void reloadJobs().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [currentWalletId, networkPk])

  useEffect(() => {
    return on(IPC_EVENT.hdAirdropProgress, (payload) => {
      const next = payload as HdAirdropJob
      setJob((current) => (current && current.id !== next.id ? current : next))
      setJobs((list) => {
        const others = list.filter((item) => item.id !== next.id)
        return [next, ...others].slice(0, 50)
      })
    })
  }, [])

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
    if (accountId && filteredAccounts.some((item) => item.id === accountId)) return
    setAccountId(filteredAccounts[0]?.id ?? '')
  }, [filteredAccounts, accountId])

  const buildInput = (): HdAirdropInput => ({
    walletId: currentWalletId ?? '',
    accountId,
    networkPk,
    tokenPk,
    fromIndex: Number(fromIndex),
    toIndex: Number(toIndex),
    accountIndex: Number(accountIndex),
    amountMode,
    amount: amountMode === 'fixed' ? amount : undefined,
    amountMin: amountMode === 'range' ? amountMin : undefined,
    amountMax: amountMode === 'range' ? amountMax : undefined,
  })

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
        <h1 className="text-lg font-semibold text-ink-200">批量转账</h1>
        <p className="mt-1 text-xs text-ink-500">
          {currentWallet ? `当前钱包：${currentWallet.name}` : '请先选择钱包'}
          {' · '}
          {network ? network.networkName : '请先选择网络'}
          {' · 进行中不会因空闲自动锁定。电脑请保持不休眠。每笔单独记账，失败可重试'}
        </p>
      </div>

      <Alert>{error}</Alert>

      {!evm ? (
        <Card title="当前网络不支持">
          <p className="text-sm text-ink-400">批量转账只支持 EVM 网络上的 ERC-20。</p>
          <Button className="mt-3" variant="ghost" onClick={openPicker}>
            切换网络
          </Button>
        </Card>
      ) : (
        <Card title="转账参数">
          <div className="space-y-3">
            <Select
              label="付款账户"
              hint="从这个地址把代币打出去，Gas 也由它付"
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

            <TokenSelect label="ERC-20 代币" tokens={erc20s} value={tokenPk} onChange={setTokenPk} />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="从序号"
                type="number"
                min={0}
                value={fromIndex}
                hint="对应分层钱包里的 address index"
                onChange={(e) => setFromIndex(e.target.value)}
              />
              <Field
                label="到序号"
                type="number"
                min={0}
                value={toIndex}
                hint={`当前钱包已有 ${hdCount} 条分层地址`}
                onChange={(e) => setToIndex(e.target.value)}
              />
              <Field
                label="账户序号"
                type="number"
                min={0}
                value={accountIndex}
                hint="一般是 0，和分层派生页一致"
                onChange={(e) => setAccountIndex(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={amountMode === 'fixed' ? 'primary' : 'ghost'}
                className="px-3 py-1 text-xs"
                onClick={() => setAmountMode('fixed')}
              >
                固定额度
              </Button>
              <Button
                type="button"
                variant={amountMode === 'range' ? 'primary' : 'ghost'}
                className="px-3 py-1 text-xs"
                onClick={() => setAmountMode('range')}
              >
                随机区间
              </Button>
            </div>

            {amountMode === 'fixed' ? (
              <Field
                label="每笔金额"
                value={amount}
                hint="每个分层地址收到同一笔数量"
                onChange={(e) => setAmount(e.target.value)}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="随机下限"
                  value={amountMin}
                  hint="含下限"
                  onChange={(e) => setAmountMin(e.target.value)}
                />
                <Field
                  label="随机上限"
                  value={amountMax}
                  hint="含上限，例如 1000–2000"
                  onChange={(e) => setAmountMax(e.target.value)}
                />
              </div>
            )}

            {hdCount === 0 ? (
              <p className="text-xs text-ink-500">
                当前钱包还没有分层地址，请先到
                <Link className="mx-1 text-honey-400 hover:underline" to="/hd">
                  分层钱包
                </Link>
                生成。
              </p>
            ) : null}

            {erc20s.length === 0 ? (
              <p className="text-xs text-ink-500">当前网络没有 ERC-20，可先到「发行代币」部署一枚，或在代币目录里添加。</p>
            ) : null}

            {preview ? (
              <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                <p>
                  从 {shorten(preview.from)} 转给 {preview.recipientCount} 个地址 · {preview.amountText}
                </p>
                <p>预估总量上限 {preview.estimatedTotal}</p>
                <p>预估 Gas {preview.feeText}</p>
                <p className="text-honey-400">预计耗时 {preview.estimatedText}，RPC 慢时可能翻倍。</p>
                {preview.missingCount > 0 ? (
                  <p className="text-honey-400">范围内还有 {preview.missingCount} 个序号没生成，已自动跳过。</p>
                ) : null}
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
                disabled={busy || running || !accountId || !tokenPk || !currentWalletId}
                onClick={() =>
                  void run(async () => {
                    setPreview(await hdAirdropApi.preview(buildInput()))
                  })
                }
              >
                预览
              </Button>
              <Button
                disabled={busy || running || !preview}
                onClick={() =>
                  void run(async () => {
                    if (!preview) return
                    const next = await hdAirdropApi.start(preview.draftId)
                    setJob(next)
                    setPreview(null)
                    setItemFilter('all')
                    setPage(1)
                    await reloadJobs(next.id)
                  })
                }
              >
                开始批量转账
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
                停止
              </Button>
            </div>
          </div>
        </Card>
      )}

      {jobs.length > 0 ? (
        <Card title={`历史批次 · ${jobs.length}`}>
          <ul className="divide-y divide-ink-700">
            {jobs.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full items-start justify-between gap-3 py-3 text-left ${
                    item.id === selectedId ? 'text-honey-400' : 'text-ink-200'
                  }`}
                  onClick={() => {
                    setJob(item)
                    setPage(1)
                  }}
                >
                  <span>
                    <span className="text-sm">
                      {item.symbol} · {item.fromIndex}–{item.toIndex} · {item.amountText}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-500">
                      成功 {item.confirmed} · 待确认 {item.pending} · 失败 {item.failed} · 未发送 {item.queued} / {item.total}
                      {item.startedAt ? ` · ${formatTime(item.startedAt)}` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 text-[11px] ${jobClass(item.status)}`}>{jobLabel(item.status)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {job ? (
        <Card
          title="执行进度与明细"
          action={<span className={`text-xs ${jobClass(job.status)}`}>{jobLabel(job.status)}</span>}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-ink-200">
              <span>
                已处理 {doneCount} / {job.total} 笔
                {job.currentIndex != null ? ` · 正在转第 ${job.currentIndex} 号` : ''}
              </span>
              <span className="tabular-nums text-honey-400">{progress}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-ink-900">
              <div className="h-full bg-honey-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-ink-400">
              成功、失败、待确认、跳过都计入进度 · 已确认 {job.confirmed} · 待确认 {job.pending} · 失败 {job.failed} · 未发送 {job.queued} · 跳过 {job.skipped}
            </p>
            <p className="text-xs text-ink-500">
              {job.status === 'running'
                ? `剩余 ${job.queued} 笔，大约还要 ${formatEta(remainMs)}`
                : `本批按 ${job.total} 笔估时 ${formatEta(job.estimatedMs)}`}
            </p>
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
                一键重试失败（{job.failed}）
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
                继续未发送（{job.queued}）
              </Button>
              {txUrl ? (
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => openExplorer(txUrl, explorerTabTitle(txUrl))}
                >
                  最近一笔
                </Button>
              ) : null}
              <Link
                to="/activity"
                className="inline-flex items-center rounded-lg border border-ink-600 px-2 py-1 text-xs text-ink-200 hover:border-honey-500 hover:text-honey-400"
              >
                交易记录
              </Link>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {(
                [
                  ['all', '全部', job.total],
                  ['failed', '失败', job.failed],
                  ['queued', '未发送', job.queued],
                  ['pending', '待确认', job.pending],
                  ['confirmed', '已确认', job.confirmed],
                  ['skipped', '跳过', job.skipped],
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
              <p className="text-sm text-ink-400">这一页没有记录。</p>
            )}
          </div>
        </Card>
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-ink-500">
          <tr>
            <th className="py-2 pr-3 font-medium">序号</th>
            <th className="py-2 pr-3 font-medium">地址</th>
            <th className="py-2 pr-3 font-medium">金额</th>
            <th className="py-2 pr-3 font-medium">状态</th>
            <th className="py-2 pr-3 font-medium">交易</th>
            <th className="py-2 font-medium">操作</th>
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
                  <span className="sensitive font-mono text-ink-200">{shorten(item.toAddress, 8, 6)}</span>
                </td>
                <td className="py-2 pr-3 text-ink-200">
                  {formatAmount(item.amount)} {symbol}
                </td>
                <td className={`py-2 pr-3 ${itemClass(item.status)}`}>
                  {itemLabel(item.status)}
                  {item.attemptCount > 1 ? ` · ${item.attemptCount} 次` : ''}
                  {item.error ? <span className="mt-0.5 block max-w-xs text-[10px] text-red-300">{item.error}</span> : null}
                </td>
                <td className="py-2 pr-3">
                  {item.txid ? <AccountAddress label="" address={item.txid} explorerUrl={url} /> : <span className="text-ink-600">—</span>}
                </td>
                <td className="py-2">
                  {retryable ? (
                    <Button variant="ghost" className="px-2 py-1 text-xs" disabled={running} onClick={() => onRetry(item)}>
                      重试
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
        第 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40" disabled={page <= 1} onClick={() => go(page - 1)}>
          上一页
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
          下一页
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
          跳转
        </button>
      </div>
    </div>
  )
}
