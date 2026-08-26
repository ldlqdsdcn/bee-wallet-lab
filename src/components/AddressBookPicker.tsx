import { useEffect, useMemo, useState } from 'react'
import type { AddressBookEntry, NetworkScope, WalletType } from '@shared/types'
import { addressBookApi } from '../lib/bridge'

/**
 * 地址簿选择器：转账页填写收款地址时使用（任务 7 接入）。
 *
 * 按当前链与网络过滤，选中后回填地址并上报 lastUsedAt。
 */
export default function AddressBookPicker({
  walletType,
  networkScope,
  networkPk,
  onSelect,
}: {
  walletType: WalletType
  networkScope: NetworkScope
  networkPk?: string | null
  onSelect: (entry: AddressBookEntry) => void
}) {
  const [entries, setEntries] = useState<AddressBookEntry[]>([])
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    void addressBookApi
      .list({ walletType, networkScope, networkPk: networkPk ?? null })
      .then((list) => {
        if (alive) setEntries(list)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [open, walletType, networkScope, networkPk])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return entries
    return entries.filter(
      (e) => e.label.toLowerCase().includes(kw) || e.address.toLowerCase().includes(kw),
    )
  }, [entries, keyword])

  const pick = (entry: AddressBookEntry) => {
    onSelect(entry)
    void addressBookApi.touch(entry.id).catch(() => undefined)
    setOpen(false)
    setKeyword('')
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="text-xs text-honey-400 hover:text-honey-500"
        onClick={() => setOpen((v) => !v)}
      >
        从地址簿选择
      </button>

      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-80 rounded-xl border border-ink-600 bg-ink-800 p-3 shadow-xl">
          <input
            autoFocus
            className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 outline-none focus:border-honey-500"
            placeholder="搜索名称 / 地址"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-xs text-ink-400">当前网络没有匹配的地址簿条目</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left hover:bg-ink-700"
                    onClick={() => pick(entry)}
                  >
                    <span className="block truncate text-xs font-medium text-ink-200">{entry.label}</span>
                    <span className="sensitive block truncate text-[11px] text-ink-400">{entry.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
