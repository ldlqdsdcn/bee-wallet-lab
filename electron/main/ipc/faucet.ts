import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type { FaucetRecord, FaucetUpsertInput } from '../../../shared/types'
import { broadcast, handle, requireObject, requireString } from './registry'
import {
  listFaucetsForNetwork,
  removeFaucet,
  restoreBuiltinFaucets,
  upsertFaucet,
} from '../catalog/faucet'

function changed<T>(value: T): T {
  broadcast(IPC_EVENT.faucetsChanged)
  return value
}

export function registerFaucetIpc(): void {
  handle<{ networkPk: string }, FaucetRecord[]>(IPC.faucetList, (arg) =>
    listFaucetsForNetwork(requireString(arg?.networkPk, 'networkPk')),
  )

  handle<FaucetUpsertInput, FaucetRecord>(IPC.faucetUpsert, (arg) => {
    const input = requireObject<FaucetUpsertInput>(arg)
    return changed(
      upsertFaucet({
        id: input.id,
        networkPk: requireString(input.networkPk, 'networkPk'),
        url: requireString(input.url, 'url'),
        label: input.label,
      }),
    )
  })

  handle<{ id: string }, true>(IPC.faucetRemove, (arg) =>
    changed(removeFaucet(requireString(arg?.id, 'id'))),
  )

  handle<{ networkPk: string }, FaucetRecord[]>(IPC.faucetRestore, (arg) =>
    changed(restoreBuiltinFaucets(requireString(arg?.networkPk, 'networkPk'))),
  )
}
