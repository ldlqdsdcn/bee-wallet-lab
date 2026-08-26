import { useEffect, useMemo, useState } from 'react'
import type { AddressBookEntry, NetworkScope, WalletType } from '@shared/types'
import { useAddressBookStore } from '../store/addressBookStore'
import { Alert, Button, Card, Field } from '../components/ui'

const WALLET_TYPES: { value: WalletType; label: string }[] = [
  { value: 'bitcoin', label: 'Bitcoin' },
  { value: 'web3', label: 'EVM' },
  { value: 'tron', label: 'TRON' },
]

const SCOPES: { value: NetworkScope; label: string }[] = [
  { value: 'mainnet', label: '主网' },
  { value: 'testnet', label: '测试网' },
]

interface FormState {
  id?: string
  label: string
  walletType: WalletType
  networkScope: NetworkScope
  address: string
  memo: string
}

const emptyForm: FormState = {
  label: '',
  walletType: 'web3',
  networkScope: 'mainnet',
  address: '',
  memo: '',
}

const selectClass =
  'w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-200 outline-none focus:border-honey-500'

function shorten(address: string): string {
  return address.length > 22 ? `${address.slice(0, 10)}…${address.slice(-8)}` : address
}

export default function AddressBookPage() {
  const entries = useAddressBookStore((s) => s.entries)
  const loading = useAddressBookStore((s) => s.loading)
  const error = useAddressBookStore((s) => s.error)
  const load = useAddressBookStore((s) => s.load)
  const save = useAddressBookStore((s) => s.save)
  const remove = useAddressBookStore((s) => s.remove)

  const [form, setForm] = useState<FormState>(emptyForm)
  const [keyword, setKeyword] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    void load({})
  }, [load])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return entries
    return entries.filter(
      (e) =>
        e.label.toLowerCase().includes(kw) ||
        e.address.toLowerCase().includes(kw) ||
        (e.memo ?? '').toLowerCase().includes(kw),
    )
  }, [entries, keyword])

  const submit = async () => {
    const ok = await save({
      id: form.id,
      label: form.label,
      walletType: form.walletType,
      networkScope: form.networkScope,
      address: form.address,
      memo: form.memo,
    })
    if (ok) setForm(emptyForm)
  }

  const edit = (entry: AddressBookEntry) => {
    setForm({
      id: entry.id,
      label: entry.label,
      walletType: entry.walletType,
      networkScope: entry.networkScope,
      address: entry.address,
      memo: entry.memo ?? '',
    })
  }

  const copy = async (entry: AddressBookEntry) => {
    await navigator.clipboard.writeText(entry.address)
    setCopiedId(entry.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-ink-200">地址簿</h1>
        <span className="text-xs text-ink-600">共 {entries.length} 条 · 仅保存公开地址信息</span>
      </div>

      <Card title={form.id ? '编辑地址' : '新增地址'}>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="名称"
            value={form.label}
            placeholder="例如：冷钱包、交易所充值"
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-400">链</span>
            <select
              className={selectClass}
              value={form.walletType}
              onChange={(e) => setForm({ ...form, walletType: e.target.value as WalletType })}
            >
              {WALLET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-400">网络环境</span>
            <select
              className={selectClass}
              value={form.networkScope}
              onChange={(e) => setForm({ ...form, networkScope: e.target.value as NetworkScope })}
            >
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="备注"
            value={form.memo}
            placeholder="可选"
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
          <div className="col-span-2">
            <Field
              label="地址"
              className="sensitive"
              value={form.address}
              placeholder="粘贴收款地址"
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Alert>{error}</Alert>
          <div className="flex gap-2">
            <Button disabled={!form.label || !form.address} onClick={() => void submit()}>
              {form.id ? '保存修改' : '添加到地址簿'}
            </Button>
            {form.id ? (
              <Button variant="ghost" onClick={() => setForm(emptyForm)}>
                取消编辑
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card
        title="已保存地址"
        action={
          <input
            className="w-48 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 outline-none focus:border-honey-500"
            placeholder="搜索名称 / 地址"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        }
      >
        {loading ? (
          <p className="text-sm text-ink-400">加载中…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-ink-400">还没有保存任何地址。转账时也可以直接把收款方存入地址簿。</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {filtered.map((entry) => (
              <li key={entry.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-200">{entry.label}</span>
                    <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-ink-400">
                      {entry.walletType === 'web3' ? 'EVM' : entry.walletType}
                    </span>
                    {entry.networkScope === 'testnet' ? (
                      <span className="rounded bg-honey-600/20 px-1.5 py-0.5 text-[10px] text-honey-400">
                        测试网
                      </span>
                    ) : null}
                  </div>
                  <p className="sensitive mt-0.5 truncate text-xs text-ink-400">{shorten(entry.address)}</p>
                  {entry.memo ? <p className="mt-0.5 truncate text-xs text-ink-600">{entry.memo}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy(entry)}>
                    {copiedId === entry.id ? '已复制' : '复制'}
                  </Button>
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => edit(entry)}>
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs hover:border-red-500 hover:text-red-400"
                    onClick={() => void remove(entry.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
