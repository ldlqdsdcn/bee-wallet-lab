import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type { ProxyCreateInput, ProxyListState, ProxyTestResult, ProxyUpdateInput } from '../../../shared/types'
import { broadcast, handle, invalidArg, requireObject, requireString } from './registry'
import {
  addProxy,
  getProxyState,
  pingAllProxies,
  pingStoredProxy,
  removeProxy,
  selectProxy,
  setProxyEnabled,
  updateProxy,
} from '../net/proxies'

function changed(state: ProxyListState): ProxyListState {
  broadcast(IPC_EVENT.proxiesChanged, state)
  return state
}

export function registerProxyIpc(): void {
  handle<void, ProxyListState>(IPC.proxyList, () => getProxyState())

  handle<ProxyCreateInput, ProxyListState>(IPC.proxyAdd, async (arg) => {
    const input = requireObject<ProxyCreateInput>(arg)
    return changed(await addProxy({ url: requireString(input.url, 'url'), label: input.label }))
  })

  handle<ProxyUpdateInput, ProxyListState>(IPC.proxyUpdate, async (arg) => {
    const input = requireObject<ProxyUpdateInput>(arg)
    return changed(
      await updateProxy({
        id: requireString(input.id, 'id'),
        url: requireString(input.url, 'url'),
        label: input.label,
      }),
    )
  })

  handle<{ id: string }, ProxyListState>(IPC.proxyRemove, async (arg) =>
    changed(await removeProxy(requireString(arg?.id, 'id'))),
  )

  handle<{ id: string }, ProxyListState>(IPC.proxySelect, async (arg) =>
    changed(await selectProxy(requireString(arg?.id, 'id'))),
  )

  handle<{ id: string }, ProxyTestResult>(IPC.proxyPing, async (arg) => {
    const result = await pingStoredProxy(requireString(arg?.id, 'id'))
    broadcast(IPC_EVENT.proxiesChanged, getProxyState())
    return result
  })

  handle<void, ProxyTestResult[]>(IPC.proxyPingAll, async () => {
    const results = await pingAllProxies()
    broadcast(IPC_EVENT.proxiesChanged, getProxyState())
    return results
  })

  handle<{ enabled: boolean }, ProxyListState>(IPC.proxySetEnabled, async (arg) => {
    if (typeof arg?.enabled !== 'boolean') throw invalidArg('enabled 无效')
    return changed(await setProxyEnabled(arg.enabled))
  })
}
