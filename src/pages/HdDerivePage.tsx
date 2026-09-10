import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HdDerivedEvmKey, HdKeyRecord } from '@shared/types'
import { accountApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Modal } from '../components/ui'
import { shorten } from '../lib/format'
import { useWalletStore } from '../store/walletStore'

const PAGE_SIZE = 50

function asRow(item: HdKeyRecord): HdDerivedEvmKey {
  return {
    id: item.id,
    index: item.addressIndex,
    path: item.path,
    address: item.address,
    publicKey: item.publicKey,
  }
}

function exportCsv(walletName: string, rows: HdDerivedEvmKey[]): void {
  const header = 'index,path,address,publicKey,privateKey'
  const lines = rows.map(
    (row) => `${row.index},${row.path},${row.address},${row.publicKey},${row.privateKey ?? ''}`,
  )
  const blob = new Blob([`${header}\n${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const first = rows[0]?.index ?? 0
  const last = rows[rows.length - 1]?.index ?? 0
  link.download = `${walletName}-hd-evm-${first}-${last}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function HdDerivePage() {
  const current = useWalletStore((s) => s.current)
  const currentId = useWalletStore((s) => s.currentId)
  const [toIndex, setToIndex] = useState('20000')
  const [fromIndex, setFromIndex] = useState('1')
  const [accountIndex, setAccountIndex] = useState('0')
  const [password, setPassword] = useState('')
  const [rows, setRows] = useState<HdDerivedEvmKey[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hideKeys, setHideKeys] = useState(true)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<HdDerivedEvmKey | null>(null)

  useEffect(() => {
    setQuery('')
    setPassword('')
    setError(null)
    setMessage(null)
    setHideKeys(true)
    setPage(1)
    setDetail(null)
    setRows([])
    if (!currentId) return
    let alive = true
    void accountApi
      .hdKeyList(currentId)
      .then((list) => {
        if (!alive) return
        setRows(list.map(asRow))
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [currentId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (row) =>
        String(row.index) === q ||
        row.address.toLowerCase().includes(q) ||
        row.path.includes(q) ||
        row.publicKey.toLowerCase().includes(q),
    )
  }, [rows, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [query])

  const count = useMemo(() => {
    const from = Number(fromIndex)
    const to = Number(toIndex)
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return 0
    return to - from + 1
  }, [fromIndex, toIndex])

  const unlocked = rows.length > 0 && rows.every((row) => row.privateKey)

  const run = async (fn: () => Promise<void>) => {
    if (!currentId) return
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

  const generate = async () => {
    if (!currentId || saving) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const next = await accountApi.hdDeriveEvm({
        walletId: currentId,
        password,
        fromIndex: Number(fromIndex),
        toIndex: Number(toIndex),
        accountIndex: Number(accountIndex),
      })
      const list = await accountApi.hdKeyList(currentId)
      const unlocked = new Map(next.rows.map((row) => [row.index, row.privateKey]))
      setRows(
        list.map((item) => ({
          ...asRow(item),
          privateKey: unlocked.get(item.addressIndex),
        })),
      )
      setPage(1)
      setPassword('')
      setMessage(
        next.skipped > 0
          ? `已跳过 ${next.skipped} 条已存在记录，新写入 ${next.saved} 条`
          : `已写入 ${next.saved} 条分层记录`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-200">分层钱包</h1>
          <p className="mt-1 text-xs text-ink-500">
            {current ? `当前钱包：${current.name}` : '请先创建或选择钱包'}
            {' · 只显示这个钱包的分层记录，切换侧栏钱包会跟着换'}
            {' · EVM · m/44\'/60\'/{account}\'/0/{index}'}
          </p>
        </div>
        <Link
          to="/hd-airdrop"
          className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-200 hover:border-honey-500 hover:text-honey-400"
        >
          批量转账
        </Link>
      </div>

      <Alert>{error}</Alert>
      {message ? <p className="rounded-lg border border-honey-600/30 bg-honey-600/10 px-3 py-2 text-xs text-honey-400">{message}</p> : null}

      <Card title="批量派生并入库">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label="从序号"
            type="number"
            min={0}
            value={fromIndex}
            hint="默认从 1 开始，0 是钱包里已有的第一个 EVM 账户"
            onChange={(e) => setFromIndex(e.target.value)}
          />
          <Field
            label="到序号"
            type="number"
            min={0}
            max={20_000}
            value={toIndex}
            hint="例如 20000，会生成从起始到这个序号的全部地址"
            onChange={(e) => setToIndex(e.target.value)}
          />
          <Field
            label="account（第 3 层）"
            type="number"
            min={0}
            value={accountIndex}
            hint="一般保持 0"
            onChange={(e) => setAccountIndex(e.target.value)}
          />
          <Field
            label="主密码"
            type="password"
            value={password}
            hint="派生、解锁私钥、清空表都要主密码"
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && password && currentId && !busy && !saving) {
                void generate()
              }
            }}
          />
        </div>
        <p className="mt-3 text-xs text-honey-400">
          即将生成 {count || 0} 条并写入 hd_keys。地址和公钥明文，私钥用主密码加密。一次最多 20000 个。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || saving || !currentId || !password || count <= 0} onClick={() => void generate()}>
            {saving ? '正在生成…' : '生成并保存'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || saving || !currentId || !password || rows.length === 0}
            onClick={() =>
              void run(async () => {
                if (!currentId) return
                const unlockedRows = await accountApi.hdKeyUnlock(currentId, password)
                setRows(unlockedRows)
                setHideKeys(false)
                setPassword('')
              })
            }
          >
            解锁私钥
          </Button>
          <Button
            variant="ghost"
            disabled={busy || saving || rows.length === 0 || !unlocked}
            onClick={() => exportCsv(current?.name ?? 'hd', rows)}
          >
            导出 CSV
          </Button>
          <Button variant="ghost" disabled={saving || rows.length === 0} onClick={() => setHideKeys((value) => !value)}>
            {hideKeys ? '显示私钥' : '隐藏私钥'}
          </Button>
          <Button
            variant="ghost"
            className="hover:border-red-500 hover:text-red-400"
            disabled={busy || saving || !currentId || !password || rows.length === 0}
            onClick={() =>
              void run(async () => {
                if (!currentId) return
                if (!window.confirm(`确定清空「${current?.name ?? '当前钱包'}」的 ${rows.length} 条分层记录？`)) return
                await accountApi.hdKeyClear(currentId, password)
                setRows([])
                setPage(1)
                setPassword('')
              })
            }
          >
            清空本表
          </Button>
        </div>
      </Card>

      <Card
        title={`${current?.name ?? '未选择钱包'} · ${filtered.length}/${rows.length} · 每页 ${PAGE_SIZE} 条`}
        action={
          <input
            className="w-64 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm text-ink-200 outline-none placeholder:text-ink-600 focus:border-honey-500"
            placeholder="搜索地址、公钥或序号"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">
            {current
              ? `「${current.name}」还没有分层记录。生成后只保存在这个钱包下。`
              : '请先在侧栏选择钱包。'}
          </p>
        ) : (
          <>
            <KeyTable rows={pageRows} hideKeys={hideKeys} onDetail={setDetail} />
            <Pager page={currentPage} pageCount={pageCount} total={filtered.length} onPage={setPage} />
          </>
        )}
      </Card>
      {detail ? (
        <HdKeyDetailDialog
          row={detail}
          walletId={currentId}
          onClose={() => setDetail(null)}
          onUnlocked={(next) => {
            setRows((prev) => prev.map((item) => (item.id === next.id ? next : item)))
            setDetail(next)
          }}
        />
      ) : null}
      {saving ? <SavingOverlay count={count} /> : null}
    </div>
  )
}

function SavingOverlay({ count }: { count: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-ink-600 bg-ink-900 px-6 py-8 text-center shadow-2xl">
        <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-ink-600 border-t-honey-400" />
        <p className="mt-4 text-sm font-medium text-ink-100">正在生成并保存</p>
        <p className="mt-2 text-xs text-ink-400">
          正在派生、加密并写入 {count} 条分层记录，请稍候，不要关闭窗口。
        </p>
      </div>
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
    const clamped = Math.min(pageCount, Math.max(1, next))
    onPage(clamped)
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
      <span>
        第 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} 条，共 {total} 条
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => go(page - 1)}
        >
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

function KeyTable({
  rows,
  hideKeys,
  onDetail,
}: {
  rows: HdDerivedEvmKey[]
  hideKeys: boolean
  onDetail: (row: HdDerivedEvmKey) => void
}) {
  return (
    <div className="overflow-auto rounded-lg border border-ink-700">
      <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_64px] gap-2 border-b border-ink-700 bg-ink-900 px-3 py-2 text-[11px] text-ink-500">
        <span>序号</span>
        <span>路径</span>
        <span>地址</span>
        <span>公钥</span>
        <span>私钥</span>
        <span>操作</span>
      </div>
      {rows.map((row) => (
        <Row key={row.id ?? row.path} row={row} hideKeys={hideKeys} onDetail={onDetail} />
      ))}
    </div>
  )
}

function Row({
  row,
  hideKeys,
  onDetail,
}: {
  row: HdDerivedEvmKey
  hideKeys: boolean
  onDetail: (row: HdDerivedEvmKey) => void
}) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_64px] items-center gap-2 border-b border-ink-800 px-3 py-2.5 text-xs">
      <span className="text-ink-400">{row.index}</span>
      <span className="truncate font-mono text-[11px] text-ink-500" title={row.path}>
        {row.path}
      </span>
      <CopyCell value={row.address} display={shorten(row.address, 8, 6)} />
      <CopyCell value={row.publicKey} display={shorten(row.publicKey, 8, 6)} />
      {row.privateKey ? (
        <CopyCell
          value={row.privateKey}
          display={hideKeys ? '••••••••' : shorten(row.privateKey, 8, 6)}
          sensitive
        />
      ) : (
        <span className="text-[11px] text-ink-600">已加密</span>
      )}
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onDetail(row)}>
        详情
      </Button>
    </div>
  )
}

function HdKeyDetailDialog({
  row,
  walletId,
  onClose,
  onUnlocked,
}: {
  row: HdDerivedEvmKey
  walletId: string | null
  onClose: () => void
  onUnlocked: (row: HdDerivedEvmKey) => void
}) {
  const [password, setPassword] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reveal = async () => {
    if (!walletId || !row.id || !password) return
    setBusy(true)
    setError(null)
    try {
      const next = await accountApi.hdKeyReveal(walletId, row.id, password)
      onUnlocked(next)
      setShowKey(true)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="分层钱包详情" onClose={onClose} wide>
      <p className="mt-1 text-xs text-ink-500">序号 {row.index} · 关闭窗口后私钥不再显示在弹框里。</p>
      <div className="mt-4 space-y-3">
        <DetailField label="序号" value={String(row.index)} />
        <DetailField label="派生路径" value={row.path} />
        <DetailField label="地址" value={row.address} />
        <DetailField label="公钥" value={row.publicKey} />
        {row.privateKey ? (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-400">私钥</span>
              <div className="flex gap-2">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? '隐藏' : '显示'}
                </Button>
                <CopyButton value={row.privateKey} />
              </div>
            </div>
            <p className="sensitive break-all rounded-lg bg-ink-800 px-3 py-2 font-mono text-xs text-honey-400">
              {showKey ? row.privateKey : '••••••••••••••••••••••••••••••••••••••••'}
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-xs text-ink-400">私钥已加密，输入主密码后可查看和复制。</p>
            <Field
              label="主密码"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password && !busy) void reveal()
              }}
            />
            {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
            <Button className="mt-3" disabled={busy || !walletId || !row.id || !password} onClick={() => void reveal()}>
              {busy ? '校验中…' : '解锁私钥'}
            </Button>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  )
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-400">{label}</span>
        <CopyButton value={value} />
      </div>
      <p className="break-all rounded-lg bg-ink-800 px-3 py-2 font-mono text-xs text-ink-200">{value}</p>
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      className="px-2 py-1 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

function CopyCell({
  value,
  display,
  sensitive,
}: {
  value: string
  display: string
  sensitive?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={`min-w-0 truncate text-left font-mono text-[11px] ${
        sensitive ? 'sensitive text-honey-400' : 'text-ink-200'
      } hover:text-honey-400`}
      title={copied ? '已复制' : value}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1000)
        })
      }}
    >
      {copied ? '已复制' : display}
    </button>
  )
}
