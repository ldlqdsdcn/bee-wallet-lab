/**
 * 三方连接：分类与站点来自目录站，这里只做列表筛选。
 */
import { DAPP_HOT_CATEGORY_ID, type DappCatalog, type DappCategoryRecord, type DappRecord } from './types'

export { DAPP_HOT_CATEGORY_ID }
export type { DappCatalog, DappCategoryRecord, DappRecord }

export function dappCategoryById(catalog: DappCatalog, id: string): DappCategoryRecord | undefined {
  return catalog.categories.find((item) => item.id === id)
}

export function dappsInCategory(catalog: DappCatalog, categoryId: string): DappRecord[] {
  const rows =
    categoryId === DAPP_HOT_CATEGORY_ID
      ? catalog.dapps.filter((item) => item.isHot)
      : catalog.dapps.filter((item) => item.categoryId === categoryId)
  return [...rows].sort((a, b) => {
    if (a.isTop !== b.isTop) return a.isTop ? -1 : 1
    if (a.sort !== b.sort) return a.sort - b.sort
    return a.name.localeCompare(b.name, 'zh')
  })
}

export function defaultDappCategoryId(catalog: DappCatalog): string | null {
  return catalog.categories[0]?.id ?? null
}
