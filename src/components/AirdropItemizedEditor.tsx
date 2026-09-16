import { useRef } from 'react'
import type { WalletType } from '@shared/types'
import {
  collectItemizedEntries,
  ITEMIZED_CSV_TEMPLATE,
  mergeItemizedRows,
  newItemizedRow,
  parseItemizedCsv,
  type ItemizedRow,
} from '@shared/airdropEntries'
import AddressBookPicker from './AddressBookPicker'
import { Button } from './ui'
import { useT } from '../i18n'

export type { ItemizedRow }

export function AirdropItemizedEditor({
  rows,
  onChange,
  walletType,
  onParsed,
}: {
  rows: ItemizedRow[]
  onChange: (rows: ItemizedRow[]) => void
  walletType: WalletType
  onParsed?: (message: string) => void
}) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const parsed = collectItemizedEntries(rows)

  const patch = (id: string, field: keyof Omit<ItemizedRow, 'id'>, value: string) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)))
  }

  const downloadTemplate = () => {
    const blob = new Blob([`\uFEFF${ITEMIZED_CSV_TEMPLATE}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'batch-transfer.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const onPickFile = (file: File | undefined) => {
    if (!file) return
    void file.text().then((text) => {
      const result = parseItemizedCsv(text)
      onChange(mergeItemizedRows(rows, result.rows))
      onParsed?.(
        `${t('airdrop.parsedRows', { count: result.rows.length })}${
          result.invalid.length ? t('airdrop.parsedInvalid', { count: result.invalid.length }) : ''
        }`,
      )
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-400">{t('airdrop.recipients')}</span>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              onPickFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button type="button" className="text-xs text-honey-400 hover:text-honey-500" onClick={() => fileRef.current?.click()}>
            {t('airdrop.csvUpload')}
          </button>
          <button type="button" className="text-xs text-honey-400 hover:text-honey-500" onClick={downloadTemplate}>
            {t('airdrop.csvTemplate')}
          </button>
          <AddressBookPicker
            multiple
            walletType={walletType}
            onSelectMany={(entries) =>
              onChange(
                mergeItemizedRows(
                  rows,
                  entries.map((entry) => ({ address: entry.address, name: entry.label, amount: '' })),
                ),
              )
            }
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-ink-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-ink-900 text-ink-500">
            <tr>
              <th className="px-2 py-2 font-medium">{t('hd.colAddress')}</th>
              <th className="w-36 px-2 py-2 font-medium">{t('airdrop.colName')}</th>
              <th className="w-28 px-2 py-2 font-medium">{t('airdrop.colAmount')}</th>
              <th className="w-16 px-2 py-2 font-medium">{t('hd.colAction')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-ink-800">
                <td className="px-2 py-1">
                  <input
                    className="sensitive w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-ink-200 outline-none focus:border-honey-500"
                    value={row.address}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="0x…"
                    onChange={(e) => patch(row.id, 'address', e.target.value)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-ink-200 outline-none focus:border-honey-500"
                    value={row.name}
                    spellCheck={false}
                    onChange={(e) => patch(row.id, 'name', e.target.value)}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-ink-200 outline-none focus:border-honey-500"
                    value={row.amount}
                    inputMode="decimal"
                    placeholder="0"
                    onChange={(e) => patch(row.id, 'amount', e.target.value)}
                  />
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    className="text-ink-500 hover:text-red-400"
                    onClick={() => onChange(rows.length <= 1 ? [newItemizedRow()] : rows.filter((item) => item.id !== row.id))}
                  >
                    {t('airdrop.removeRow')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange([...rows, newItemizedRow()])}>
          {t('airdrop.addRow')}
        </Button>
        <p className="text-xs text-ink-600">
          {t('airdrop.itemizedHint')} {t('airdrop.csvHint')}
          {parsed.entries.length ? ` · ${t('airdrop.parsed', { count: parsed.entries.length })}` : ''}
          {parsed.invalid.length ? t('airdrop.parsedInvalid', { count: parsed.invalid.length }) : ''}
        </p>
      </div>
    </div>
  )
}
