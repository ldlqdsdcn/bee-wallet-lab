/**
 * 明细批量：每笔收款地址 + 名称 + 金额。
 * CSV 三列：收款地址,名称,转账金额。第一行可以是表头。
 */
import { isEvmAddress } from './airdropAddresses'

export interface ItemizedRow {
  id: string
  address: string
  name: string
  amount: string
}

export interface ParsedCsvRows {
  rows: Array<Omit<ItemizedRow, 'id'>>
  invalid: string[]
  skippedHeader: boolean
}

let seq = 0

export function newItemizedRow(partial?: Partial<Omit<ItemizedRow, 'id'>>): ItemizedRow {
  seq += 1
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `row-${Date.now()}-${seq}`
  return {
    id,
    address: partial?.address?.trim() ?? '',
    name: partial?.name?.trim() ?? '',
    amount: partial?.amount?.trim() ?? '',
  }
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === ',' || ch === '，' || ch === ';' || ch === '；' || ch === '\t') {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

function looksLikeHeader(cells: string[]): boolean {
  const head = cells[0]?.trim() ?? ''
  if (isEvmAddress(head)) return false
  const text = cells.join(' ').toLowerCase()
  return /地址|address|收款/.test(text)
}

function looksLikeAmount(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim())
}

export function parseItemizedCsv(text: string): ParsedCsvRows {
  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
  const rows: Array<Omit<ItemizedRow, 'id'>> = []
  const invalid: string[] = []
  let skippedHeader = false
  lines.forEach((line, index) => {
    const cells = parseCsvLine(line)
    if (index === 0 && looksLikeHeader(cells)) {
      skippedHeader = true
      return
    }
    const address = cells[0] ?? ''
    let name = cells[1] ?? ''
    let amount = cells[2] ?? ''
    if (cells.length === 2) {
      if (looksLikeAmount(cells[1] ?? '') && !looksLikeAmount(cells[2] ?? '')) {
        amount = cells[1] ?? ''
        name = ''
      }
    }
    if (!address) return
    if (!isEvmAddress(address)) {
      invalid.push(address)
      return
    }
    rows.push({ address, name, amount })
  })
  return { rows, invalid, skippedHeader }
}

export function mergeItemizedRows(
  current: ItemizedRow[],
  incoming: Array<Partial<Omit<ItemizedRow, 'id'>>>,
): ItemizedRow[] {
  const next = current.map((row) => ({ ...row }))
  const byAddress = new Map<string, number>()
  next.forEach((row, index) => {
    const key = row.address.trim().toLowerCase()
    if (key) byAddress.set(key, index)
  })
  for (const item of incoming) {
    const address = item.address?.trim() ?? ''
    if (!address) continue
    const key = address.toLowerCase()
    const existing = byAddress.get(key)
    if (existing != null) {
      const row = next[existing]!
      if (!row.name && item.name) row.name = item.name.trim()
      if (!row.amount && item.amount) row.amount = item.amount.trim()
      continue
    }
    const row = newItemizedRow({
      address,
      name: item.name,
      amount: item.amount,
    })
    byAddress.set(key, next.length)
    next.push(row)
  }
  return next.filter((row, index, list) => {
    if (row.address.trim() || row.name.trim() || row.amount.trim()) return true
    return index === list.length - 1
  })
}

export function collectItemizedEntries(rows: ItemizedRow[]): {
  entries: Array<{ address: string; name: string; amount: string }>
  invalid: string[]
  missingAmount: number
} {
  const seen = new Set<string>()
  const entries: Array<{ address: string; name: string; amount: string }> = []
  const invalid: string[] = []
  let missingAmount = 0
  for (const row of rows) {
    const address = row.address.trim()
    const name = row.name.trim()
    const amount = row.amount.trim()
    if (!address && !name && !amount) continue
    if (!isEvmAddress(address)) {
      if (address) invalid.push(address)
      continue
    }
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (!amount || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      missingAmount += 1
      continue
    }
    entries.push({ address, name, amount })
  }
  return { entries, invalid, missingAmount }
}

export const ITEMIZED_CSV_TEMPLATE = '收款地址,名称,转账金额\n'
