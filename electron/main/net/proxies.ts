/**
 * 代理列表：增删、选用、测速、总开关。
 */
import type { ProxyCreateInput, ProxyListState, ProxyTestResult, ProxyUpdateInput } from '@shared/types'
import { newId } from '../security/crypto'
import { loadSettings, peekLegacyProxyUrl, saveSettings } from '../db/repos/metaRepo'
import {
  deleteProxy,
  findProxyByUrl,
  getProxy,
  insertProxy,
  listProxies,
  selectedProxy,
  setProxySelected,
  updateProxyPing,
  updateProxyRow,
} from '../db/repos/proxyRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { applyActiveProxy, displayProxyUrl, normalizeProxyUrl, probeProxy } from './proxy'
import { resetPriceBackoff } from '../price'
import { reconnectWalletConnectRelay } from '../walletconnect/service'

async function applyProxyAndRelay(): Promise<void> {
  const error = await applyActiveProxy()
  const current = selectedProxy()
  if (current && loadSettings().proxyEnabled) {
    updateProxyPing(current.id, {
      latencyMs: error ? null : current.lastLatencyMs,
      error,
    })
  }
  resetPriceBackoff()
  void reconnectWalletConnectRelay()
}

function labelOfUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return displayProxyUrl(url)
  }
}

export function migrateLegacyProxy(): void {
  const legacy = peekLegacyProxyUrl()
  if (!legacy) return
  if (listProxies().length === 0) {
    try {
      const url = normalizeProxyUrl(legacy)
      if (url) {
        insertProxy({
          id: newId(),
          url,
          label: labelOfUrl(url),
          isSelected: true,
        })
        saveSettings({ proxyEnabled: true })
        return
      }
    } catch {
      /* 旧地址不合法就丢掉 */
    }
  }
  saveSettings({})
}

export function getProxyState(): ProxyListState {
  return { enabled: loadSettings().proxyEnabled, proxies: listProxies() }
}

export async function setProxyEnabled(enabled: boolean): Promise<ProxyListState> {
  if (enabled && !selectedProxy()) {
    const first = listProxies()[0]
    if (first) setProxySelected(first.id)
  }
  saveSettings({ proxyEnabled: enabled })
  await applyProxyAndRelay()
  return getProxyState()
}

export async function addProxy(input: ProxyCreateInput): Promise<ProxyListState> {
  let url: string
  try {
    url = normalizeProxyUrl(input.url)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : '代理地址无效')
  }
  if (!url) throw invalidArg('代理地址不能为空')
  if (findProxyByUrl(url)) throw invalidArg('该代理已经添加过')
  const select = !selectedProxy()
  insertProxy({
    id: newId(),
    url,
    label: input.label?.trim() || labelOfUrl(url),
    isSelected: select,
  })
  if (select && loadSettings().proxyEnabled) {
    await applyProxyAndRelay()
  }
  return getProxyState()
}

export async function updateProxy(input: ProxyUpdateInput): Promise<ProxyListState> {
  const current = getProxy(input.id)
  if (!current) throw notFound('代理不存在')
  let url: string
  try {
    url = normalizeProxyUrl(input.url)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : '代理地址无效')
  }
  if (!url) throw invalidArg('代理地址不能为空')
  const duplicate = findProxyByUrl(url)
  if (duplicate && duplicate.id !== current.id) throw invalidArg('该代理已经添加过')
  const label = input.label?.trim() || labelOfUrl(url)
  const urlChanged = url !== current.url
  updateProxyRow(current.id, { url, label, clearPing: urlChanged })
  if (urlChanged && current.isSelected && loadSettings().proxyEnabled) {
    await applyProxyAndRelay()
  }
  return getProxyState()
}

export async function removeProxy(id: string): Promise<ProxyListState> {
  const current = getProxy(id)
  if (!current) throw notFound('代理不存在')
  const wasSelected = current.isSelected
  deleteProxy(id)
  if (wasSelected) {
    const next = listProxies()[0]
    if (next) setProxySelected(next.id)
  }
  await applyProxyAndRelay()
  return getProxyState()
}

export async function selectProxy(id: string): Promise<ProxyListState> {
  if (!getProxy(id)) throw notFound('代理不存在')
  setProxySelected(id)
  await applyProxyAndRelay()
  return getProxyState()
}

export async function pingStoredProxy(id: string): Promise<ProxyTestResult> {
  const current = getProxy(id)
  if (!current) throw notFound('代理不存在')
  const result = await probeProxy(current.url)
  updateProxyPing(id, {
    latencyMs: result.ok ? result.latencyMs : null,
    error: result.ok ? null : result.message,
  })
  if (result.ok && current.isSelected && loadSettings().proxyEnabled) {
    await applyActiveProxy()
  }
  return result
}

export async function pingAllProxies(): Promise<ProxyTestResult[]> {
  const results: ProxyTestResult[] = []
  for (const item of listProxies()) {
    results.push(await pingStoredProxy(item.id))
  }
  return results
}
