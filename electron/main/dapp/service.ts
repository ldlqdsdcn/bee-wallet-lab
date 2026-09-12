/**
 * 三方连接：从目录站拉分类和站点，去掉本地写死的链接。
 */
import type { DappCatalog, DappCategoryRecord } from '@shared/types'
import { ENERGY_CATALOG_HINT } from '../energy/codec'
import { getBaseUrl } from '../backend/config'
import { invalidArg } from '../ipc/registry'
import { fetchDappCategories, fetchDapps } from './api'
import { assembleDappCatalog } from './codec'

let cached: DappCatalog | null = null

export function peekDappCategories(): DappCategoryRecord[] {
  return cached?.categories ?? []
}

export function clearDappCatalogCache(): void {
  cached = null
}

export async function loadDappCatalog(force = false): Promise<DappCatalog> {
  if (!getBaseUrl()) {
    throw invalidArg(`请先在设置里填写目录站地址，三方连接使用 ${ENERGY_CATALOG_HINT}`)
  }
  if (cached && !force) return cached
  const [rawCategories, rawDapps] = await Promise.all([fetchDappCategories(), fetchDapps()])
  cached = assembleDappCatalog(rawCategories, rawDapps)
  return cached
}
