import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type {
  CatalogSyncResult,
  CurrencyRecord,
  NetworkRecord,
  TokenRecord,
} from '../../../shared/types'
import { handle, broadcast } from './registry'
import {
  getCatalogCurrencies,
  getCatalogNetworks,
  getCatalogTokens,
  syncCatalog,
} from '../catalog/sync'

export function registerCatalogIpc(): void {
  handle<void, NetworkRecord[]>(IPC.catalogNetworks, () => getCatalogNetworks())

  handle<{ networkPk?: string }, TokenRecord[]>(IPC.catalogTokens, (arg) =>
    getCatalogTokens(arg?.networkPk),
  )

  handle<void, CurrencyRecord[]>(IPC.catalogCurrencies, () => getCatalogCurrencies())

  handle<{ force?: boolean }, CatalogSyncResult>(IPC.catalogSync, async (arg) => {
    const result = await syncCatalog(Boolean(arg?.force))
    broadcast(IPC_EVENT.catalogUpdated, result)
    return result
  })
}
