/**
 * 三方连接目录解包。路径与 bee-wallet-server DappCategoryApi / DappApi 对齐。
 */
import { DAPP_HOT_CATEGORY_ID, type DappCatalog, type DappCategoryRecord, type DappRecord } from '@shared/types'
import { asNumber, asRecord, asString } from '../backend/list'

export const DAPP_CATEGORY_API = '/api/dappCategory'
export const DAPP_API = '/api/dapp'

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = asString(record[key])
    if (text) return text
  }
  return ''
}

function asFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return (
      normalized !== '' &&
      normalized !== '0' &&
      normalized !== 'n' &&
      normalized !== 'no' &&
      normalized !== 'false' &&
      normalized !== 'off'
    )
  }
  return false
}

export function parseHttpsUrl(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

export function parseDappCategory(row: unknown): DappCategoryRecord | null {
  const record = asRecord(row)
  if (!record) return null
  const id = pickString(record, ['id', 'categoryId'])
  const name = pickString(record, ['categoryName', 'catetoryName', 'categorName', 'name'])
  if (!id || !name) return null
  return {
    id,
    name,
    icon: parseHttpsUrl(pickString(record, ['icon', 'categoryIcon', 'catetoryIcon', 'categorIcon'])),
    sort: asNumber(record.sort, 0),
    virtual: false,
  }
}

export function parseDapp(row: unknown): DappRecord | null {
  const record = asRecord(row)
  if (!record) return null
  const id = pickString(record, ['id'])
  const name = pickString(record, ['dappName', 'name'])
  const url = parseHttpsUrl(pickString(record, ['dappUrl', 'url', 'link']))
  if (!id || !name || !url) return null
  return {
    id,
    categoryId: pickString(record, ['categoryId']),
    name,
    url,
    icon: parseHttpsUrl(pickString(record, ['icon', 'dappIcon'])),
    remark: pickString(record, ['remark', 'description', 'desc', 'intro', 'dappDesc', 'memo', 'note']) || null,
    isHot: asFlag(record.isHot ?? record.hot),
    isTop: asFlag(record.isTop ?? record.top),
    sort: asNumber(record.sort, 0),
  }
}

export function assembleDappCatalog(rawCategories: unknown[], rawDapps: unknown[]): DappCatalog {
  const dapps = rawDapps
    .map((row) => parseDapp(row))
    .filter((item): item is DappRecord => Boolean(item))
    .sort((a, b) => {
      if (a.isTop !== b.isTop) return a.isTop ? -1 : 1
      if (a.sort !== b.sort) return a.sort - b.sort
      return a.name.localeCompare(b.name, 'zh')
    })

  const categories = rawCategories
    .map((row) => parseDappCategory(row))
    .filter((item): item is DappCategoryRecord => Boolean(item))
    .sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : a.name.localeCompare(b.name, 'zh')))

  if (dapps.some((item) => item.isHot) && !categories.some((item) => item.id === DAPP_HOT_CATEGORY_ID)) {
    categories.unshift({
      id: DAPP_HOT_CATEGORY_ID,
      name: '',
      icon: null,
      sort: -1,
      virtual: true,
    })
  }

  return { categories, dapps }
}
