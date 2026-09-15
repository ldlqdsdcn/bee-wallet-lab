import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type { RpcNodeCreateInput, RpcNodeRecord, RpcNodeUpdateInput, RpcPingResult } from '../../../shared/types'
import { broadcast, handle, requireObject, requireString } from './registry'
import {
  addRpcNode,
  clearSelectedRpc,
  listRpcNodesForNetwork,
  updateRpcNode,
  pingAllRpcNodes,
  pingRpcNode,
  removeRpcNode,
  restoreBuiltinRpcNodes,
  selectRpcNode,
} from '../rpc/nodes'

function changed<T>(value: T): T {
  broadcast(IPC_EVENT.rpcNodesChanged)
  return value
}

export function registerRpcIpc(): void {
  handle<{ networkPk: string }, RpcNodeRecord[]>(IPC.rpcList, (arg) =>
    listRpcNodesForNetwork(requireString(arg?.networkPk, 'networkPk')),
  )

  handle<RpcNodeCreateInput, RpcNodeRecord>(IPC.rpcAdd, (arg) => {
    const input = requireObject<RpcNodeCreateInput>(arg)
    return changed(
      addRpcNode({
        networkPk: requireString(input.networkPk, 'networkPk'),
        url: requireString(input.url, 'url'),
        label: input.label,
        headersText: typeof input.headersText === 'string' ? input.headersText : undefined,
      }),
    )
  })

  handle<RpcNodeUpdateInput, RpcNodeRecord>(IPC.rpcUpdate, (arg) => {
    const input = requireObject<RpcNodeUpdateInput>(arg)
    return changed(
      updateRpcNode({
        id: requireString(input.id, 'id'),
        url: typeof input.url === 'string' ? input.url : undefined,
        label: input.label,
        headersText: typeof input.headersText === 'string' ? input.headersText : undefined,
      }),
    )
  })

  handle<{ id: string }, true>(IPC.rpcRemove, (arg) =>
    changed(removeRpcNode(requireString(arg?.id, 'id'))),
  )

  handle<{ id?: string; networkPk?: string }, RpcNodeRecord | RpcNodeRecord[]>(IPC.rpcSelect, (arg) => {
    if (arg?.id) return changed(selectRpcNode(requireString(arg.id, 'id')))
    return changed(clearSelectedRpc(requireString(arg?.networkPk, 'networkPk')))
  })

  handle<{ id: string }, RpcPingResult>(IPC.rpcPing, (arg) => pingRpcNode(requireString(arg?.id, 'id')))

  handle<{ networkPk: string }, RpcPingResult[]>(IPC.rpcPingAll, (arg) =>
    pingAllRpcNodes(requireString(arg?.networkPk, 'networkPk')),
  )

  handle<{ networkPk: string }, RpcNodeRecord[]>(IPC.rpcRestore, (arg) =>
    changed(restoreBuiltinRpcNodes(requireString(arg?.networkPk, 'networkPk'))),
  )
}
