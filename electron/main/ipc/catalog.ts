import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type {
  CatalogLookupQuery,
  CatalogLookupResult,
  CatalogSyncResult,
  CurrencyRecord,
  NetworkRecord,
  NetworkUpsertInput,
  TokenRecord,
  TokenUpsertInput,
} from '../../../shared/types'
import { handle, broadcast, requireObject, requireString } from './registry'
import {
  getCatalogCurrencies,
  getCatalogNetworks,
  getCatalogTokens,
  syncCatalog,
} from '../catalog/sync'
import { lookupCatalogNetwork } from '../catalog/lookup'
import { refreshAppMenu } from '../appMenu'
import {
  removeCatalogNetwork,
  removeCatalogToken,
  upsertCatalogNetwork,
  upsertCatalogToken,
} from '../catalog/maintain'

function changed<T>(value: T): T {
  broadcast(IPC_EVENT.catalogUpdated, { kind: 'maintain' })
  refreshAppMenu()
  return value
}

export function registerCatalogIpc(): void {
  handle<void, NetworkRecord[]>(IPC.catalogNetworks, () => getCatalogNetworks())

  handle<{ networkPk?: string }, TokenRecord[]>(IPC.catalogTokens, (arg) =>
    getCatalogTokens(arg?.networkPk),
  )

  handle<void, CurrencyRecord[]>(IPC.catalogCurrencies, () => getCatalogCurrencies())

  handle<{ force?: boolean }, CatalogSyncResult>(IPC.catalogSync, async (arg) => {
    const result = await syncCatalog(Boolean(arg?.force))
    broadcast(IPC_EVENT.catalogUpdated, result)
    refreshAppMenu()
    return result
  })

  handle<NetworkUpsertInput, NetworkRecord>(IPC.catalogNetworkUpsert, async (arg) =>
    changed(await upsertCatalogNetwork(requireObject<NetworkUpsertInput>(arg))),
  )

  handle<{ id: string }, true>(IPC.catalogNetworkRemove, (arg) =>
    changed(removeCatalogNetwork(requireString(arg?.id, 'id'))),
  )

  handle<TokenUpsertInput, TokenRecord>(IPC.catalogTokenUpsert, (arg) =>
    changed(upsertCatalogToken(requireObject<TokenUpsertInput>(arg))),
  )

  handle<{ id: string }, true>(IPC.catalogTokenRemove, (arg) =>
    changed(removeCatalogToken(requireString(arg?.id, 'id'))),
  )

  handle<CatalogLookupQuery, CatalogLookupResult>(IPC.catalogLookup, (arg) =>
    lookupCatalogNetwork(requireObject<CatalogLookupQuery>(arg ?? {})),
  )
}
