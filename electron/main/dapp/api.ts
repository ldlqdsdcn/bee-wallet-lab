/**
 * 三方连接目录站接口。路径与 bee-wallet-server /api/dappCategory、/api/dapp 对齐。
 */
import { get } from '../backend/client'
import { extractList } from '../backend/list'
import { DAPP_API, DAPP_CATEGORY_API } from './codec'

export async function fetchDappCategories(): Promise<unknown[]> {
  const data = await get<unknown>(`${DAPP_CATEGORY_API}/list`)
  return extractList(data)
}

export async function fetchDapps(query?: { categoryId?: string; isHot?: string; isTop?: string }): Promise<unknown[]> {
  const data = await get<unknown>(`${DAPP_API}/list`, query)
  return extractList(data)
}
