import { useEffect, useMemo, useState } from 'react'
import type { AddressBookEntry, AddressBookQuery, NetworkScope, WalletType } from '@shared/types'
import { addressBookApi } from '../lib/bridge'
import { walletTypeLabel } from '../lib/format'
import { useT } from '../i18n'

/** EVM / Solana / TRON 按链类型；Bitcoin 还要区分主网和测试网。 */
export function addressBookPickerQuery(walletType: WalletType, networkScope?: NetworkScope): AddressBookQuery {
  if (walletType === 'bitcoin') return { walletType, networkScope }
  return { walletType }
}

/**
 * 地址簿选择器：按链类型筛选。比特币额外按主网 / 测试网区分。
 */
export default function AddressBookPicker(
  props: {
    walletType: WalletType
    networkScope?: NetworkScope
  } & (
    | { multiple?: false; onSelect: (entry: AddressBookEntry) => void; onSelectMany?: never }
    | { multiple: true; onSelect?: never; onSelectMany: (entries: AddressBookEntry[]) => void }
  ),
) {
  const { walletType, networkScope, multiple } = props
  const t = useT()
  const [entries, setEntries] = useState<AddressBookEntry[]>([])
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open) return
    let alive = true
    void addressBookApi
      .list(addressBookPickerQuery(walletType, networkScope))
      .then((list) => {
        if (alive) setEntries(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [open, walletType, networkScope])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return entries
    return entries.filter(
      (e) => e.label.toLowerCase().includes(kw) || e.address.toLowerCase().includes(kw),
    )
  }, [entries, keyword])

  const close = () => {
    setOpen(false)
    setKeyword('')
    setPicked(new Set())
  }

  const pickOne = (entry: AddressBookEntry) => {
    if (multiple) return
    props.onSelect(entry)
    void addressBookApi.touch(entry.id).catch(() => undefined)
    close()
  }

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const confirmMany = () => {
    if (!multiple) return
    const selected = entries.filter((entry) => picked.has(entry.id))
    if (selected.length === 0) {
      close()
      return
    }
    props.onSelectMany(selected)
    for (const entry of selected) {
      void addressBookApi.touch(entry.id).catch(() => undefined)
    }
    close()
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="text-xs text-honey-400 hover:text-honey-500"
        onClick={() => setOpen((v) => !v)}
      >
        {t('picker.addressBook')}
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl border border-ink-600 bg-ink-800 p-3 shadow-xl">
          <input
            autoFocus
            className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 outline-none focus:border-honey-500"
            placeholder={t('picker.search')}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-xs text-ink-400">{t('picker.empty')}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  {multiple ? (
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-ink-700">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={picked.has(entry.id)}
                        onChange={() => toggle(entry.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-ink-200">{entry.label}</span>
                        <span className="block truncate text-[11px] text-ink-500">
                          {entry.networkName || walletTypeLabel(entry.walletType)} ·{' '}
                          {entry.networkScope === 'testnet' ? t('common.testnet') : t('common.mainnet')}
                        </span>
                        <span className="sensitive block truncate text-[11px] text-ink-400">{entry.address}</span>
                      </span>
                    </label>
                  ) : (
                    <button
                      type="button"
                      className="w-full rounded-lg px-2 py-2 text-left hover:bg-ink-700"
                      onClick={() => pickOne(entry)}
                    >
                      <span className="block truncate text-xs font-medium text-ink-200">{entry.label}</span>
                      <span className="block truncate text-[11px] text-ink-500">
                        {entry.networkName || walletTypeLabel(entry.walletType)} ·{' '}
                        {entry.networkScope === 'testnet' ? t('common.testnet') : t('common.mainnet')}
                      </span>
                      <span className="sensitive block truncate text-[11px] text-ink-400">{entry.address}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {multiple ? (
            <button
              type="button"
              className="mt-2 w-full rounded-lg border border-ink-600 px-2 py-1.5 text-xs text-honey-400 hover:border-honey-500"
              onClick={confirmMany}
            >
              {t('picker.addSelected', { count: picked.size })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
