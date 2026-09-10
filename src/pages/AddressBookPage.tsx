import { useEffect, useMemo, useState } from 'react'
import type { AddressBookEntry, NetworkScope, WalletType } from '@shared/types'
import { useAddressBookStore } from '../store/addressBookStore'
import { Alert, Button, Card, Field } from '../components/ui'
import { walletTypeLabel } from '../lib/format'
import { useT } from '../i18n'

const WALLET_TYPES: { value: WalletType; label: string }[] = [
  { value: 'bitcoin', label: 'Bitcoin' },
  { value: 'web3', label: 'EVM' },
  { value: 'tron', label: 'TRON' },
  { value: 'solana', label: 'Solana' },
]

const SCOPES: NetworkScope[] = ['mainnet', 'testnet']

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
  const t = useT()
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
        <h1 className="text-lg font-semibold text-ink-200">{t('book.title')}</h1>
        <span className="text-xs text-ink-600">{t('book.count', { count: entries.length })}</span>
      </div>

      <Card title={form.id ? t('book.edit') : t('book.addNew')}>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t('common.name')}
            value={form.label}
            placeholder={t('book.namePh')}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-400">{t('book.chain')}</span>
            <select
              className={selectClass}
              value={form.walletType}
              onChange={(e) => setForm({ ...form, walletType: e.target.value as WalletType })}
            >
              {WALLET_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-400">{t('book.scope')}</span>
            <select
              className={selectClass}
              value={form.networkScope}
              onChange={(e) => setForm({ ...form, networkScope: e.target.value as NetworkScope })}
            >
              {SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope === 'testnet' ? t('common.testnet') : t('common.mainnet')}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t('book.memo')}
            value={form.memo}
            placeholder={t('book.memoPh')}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
          />
          <div className="col-span-2">
            <Field
              label={t('common.address')}
              className="sensitive"
              value={form.address}
              placeholder={t('book.addressPh')}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Alert>{error}</Alert>
          <div className="flex gap-2">
            <Button disabled={!form.label || !form.address} onClick={() => void submit()}>
              {form.id ? t('book.saveEdit') : t('book.addTo')}
            </Button>
            {form.id ? (
              <Button variant="ghost" onClick={() => setForm(emptyForm)}>
                {t('book.cancelEdit')}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card
        title={t('book.saved')}
        action={
          <input
            className="w-48 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 outline-none focus:border-honey-500"
            placeholder={t('picker.search')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        }
      >
        {loading ? (
          <p className="text-sm text-ink-400">{t('common.loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-ink-400">{t('book.emptyHint')}</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {filtered.map((entry) => (
              <li key={entry.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-200">{entry.label}</span>
                    <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase text-ink-400">
                      {walletTypeLabel(entry.walletType)}
                    </span>
                    {entry.networkScope === 'testnet' ? (
                      <span className="rounded bg-honey-600/20 px-1.5 py-0.5 text-[10px] text-honey-400">
                        {t('common.testnet')}
                      </span>
                    ) : null}
                  </div>
                  <p className="sensitive mt-0.5 truncate text-xs text-ink-400">{shorten(entry.address)}</p>
                  {entry.memo ? <p className="mt-0.5 truncate text-xs text-ink-600">{entry.memo}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy(entry)}>
                    {copiedId === entry.id ? t('common.copied') : t('common.copy')}
                  </Button>
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => edit(entry)}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs hover:border-red-500 hover:text-red-400"
                    onClick={() => void remove(entry.id)}
                  >
                    {t('common.delete')}
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
