import { IPC } from '../../../shared/ipc'
import type { DappCatalog } from '../../../shared/types'
import { handle } from './registry'
import { loadDappCatalog } from '../dapp/service'

export function registerDappIpc(): void {
  handle<{ force?: boolean } | void, DappCatalog>(IPC.dappCatalog, (arg) =>
    loadDappCatalog(Boolean(arg && typeof arg === 'object' && arg.force)),
  )
}
