/**
 * RPC 节点维护：内置候选入库、用户增删、测延迟、手动选当前节点。
 */
import type {
  NetworkRecord,
  NetworkScope,
  RpcNodeCreateInput,
  RpcNodeRecord,
  RpcNodeUpdateInput,
  RpcPingResult,
  WalletType,
} from '@shared/types'
import { parseRpcHeaders } from '@shared/rpcHeaders'
import { newId } from '../security/crypto'
import { getNetwork, listNetworks } from '../db/repos/catalogRepo'
import {
  clearRpcSelection,
  deleteBuiltinRpcNodes,
  deleteRpcNode,
  findRpcNode,
  getRpcNode,
  insertRpcNode,
  listRpcNodes,
  selectedRpcNode,
  setRpcSelected,
  updateRpcNodeFields,
  updateRpcPing,
} from '../db/repos/rpcNodeRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { builtinRpcUrls, resolveBitcoinApiBase, resolveTronApiBase } from './endpoints'
import { getPreferredRpc, setPreferredRpc } from './preference'
import { providerGet, providerPost } from './fetch'
import { joinRpcPath, normalizeRpcUrl } from './url'

const PING_TIMEOUT_MS = 8_000

function parseUserUrl(raw: string): string {
  try {
    return normalizeRpcUrl(raw)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : 'RPC 地址无效')
  }
}

function labelOfUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function ensureRpcSeeded(network: NetworkRecord): void {
  const existing = new Set(listRpcNodes(network.id).map((item) => item.url))
  for (const url of builtinRpcUrls(network)) {
    if (existing.has(url)) continue
    insertRpcNode({
      id: newId(),
      networkPk: network.id,
      url,
      label: labelOfUrl(url),
      source: 'builtin',
      isSelected: false,
    })
    existing.add(url)
  }
}

function requireNetwork(networkPk: string): NetworkRecord {
  const network = getNetwork(networkPk)
  if (!network) throw notFound('网络不存在，请先同步目录')
  return network
}

export function listRpcNodesForNetwork(networkPk: string): RpcNodeRecord[] {
  const network = requireNetwork(networkPk)
  ensureRpcSeeded(network)
  return listRpcNodes(networkPk)
}

export function addRpcNode(input: RpcNodeCreateInput): RpcNodeRecord {
  const network = requireNetwork(input.networkPk)
  ensureRpcSeeded(network)
  const url = parseUserUrl(input.url)
  if (findRpcNode(network.id, url)) throw invalidArg('该节点已经添加过')
  return insertRpcNode({
    id: newId(),
    networkPk: network.id,
    url,
    label: input.label?.trim() || labelOfUrl(url),
    headers: parseRpcHeaders(input.headersText ?? ''),
    source: 'custom',
    isSelected: false,
  })
}

export function updateRpcNode(input: RpcNodeUpdateInput): RpcNodeRecord {
  const node = getRpcNode(input.id)
  if (!node) throw notFound('节点不存在')
  const url = input.url !== undefined ? parseUserUrl(input.url) : node.url
  if (url !== node.url) {
    const existing = findRpcNode(node.networkPk, url)
    if (existing && existing.id !== node.id) throw invalidArg('该节点已经添加过')
  }
  const next = updateRpcNodeFields(input.id, {
    url,
    label: input.label !== undefined ? input.label.trim() || labelOfUrl(url) : undefined,
    headers: input.headersText !== undefined ? parseRpcHeaders(input.headersText) : undefined,
    clearPing: url !== node.url,
  })
  if (!next) throw notFound('节点不存在')
  if (node.isSelected && url !== node.url) setPreferredRpc(node.networkPk, url)
  return next
}

export function removeRpcNode(id: string): true {
  const node = getRpcNode(id)
  if (!node) throw notFound('节点不存在')
  deleteRpcNode(id)
  if (node.isSelected) setPreferredRpc(node.networkPk, null)
  return true
}

export function selectRpcNode(id: string): RpcNodeRecord {
  const node = getRpcNode(id)
  if (!node) throw notFound('节点不存在')
  setRpcSelected(id, node.networkPk)
  setPreferredRpc(node.networkPk, node.url)
  return getRpcNode(id) as RpcNodeRecord
}

export function clearSelectedRpc(networkPk: string): RpcNodeRecord[] {
  requireNetwork(networkPk)
  clearRpcSelection(networkPk)
  setPreferredRpc(networkPk, null)
  return listRpcNodes(networkPk)
}

export function restoreBuiltinRpcNodes(networkPk: string): RpcNodeRecord[] {
  const network = requireNetwork(networkPk)
  const selected = selectedRpcNode(networkPk)
  deleteBuiltinRpcNodes(networkPk)
  ensureRpcSeeded(network)
  if (selected) {
    const again = findRpcNode(networkPk, selected.url)
    if (again) setRpcSelected(again.id, networkPk)
  }
  return listRpcNodes(networkPk)
}

export { selectedRpcNode }

/** 手动选中的排最前，其次是上次打通的，再是列表里其余地址。 */
export function rpcUrlsForNetwork(network: NetworkRecord): string[] {
  ensureRpcSeeded(network)
  const rows = listRpcNodes(network.id)
  const selected = rows.find((item) => item.isSelected)?.url
  const preferred = getPreferredRpc(network.id)
  const rest = rows.map((item) => item.url)
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of [selected, preferred, ...rest, ...builtinRpcUrls(network)]) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function networkByType(walletType: WalletType, scope: NetworkScope): NetworkRecord | null {
  return listNetworks().find((item) => item.walletType === walletType && item.networkScope === scope) ?? null
}

export function bitcoinApiCandidates(scope: NetworkScope): string[] {
  const network = networkByType('bitcoin', scope)
  if (network) return rpcUrlsForNetwork(network)
  return [resolveBitcoinApiBase(scope)]
}

export function tronApiCandidates(scope: NetworkScope): string[] {
  const network = networkByType('tron', scope)
  if (network) return rpcUrlsForNetwork(network)
  return [resolveTronApiBase(scope)]
}

export async function tryRpcUrls<T>(
  urls: string[],
  run: (url: string) => Promise<T>,
): Promise<{ url: string; result: T }> {
  let last: Error | null = null
  if (urls.length === 0) throw new Error('没有可用的节点')
  for (const url of urls) {
    try {
      const result = await run(url)
      return { url, result }
    } catch (err) {
      last = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw last ?? new Error('没有可用的节点')
}

async function pingUrl(network: NetworkRecord, url: string): Promise<void> {
  if (network.walletType === 'web3') {
    const body = await providerPost<{ error?: { message?: string } }>(
      url,
      { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
      { timeoutMs: PING_TIMEOUT_MS },
    )
    if (body?.error) throw new Error(body.error.message || 'RPC 返回错误')
    return
  }
  if (network.walletType === 'bitcoin') {
    await providerGet(`${url}/blocks/tip/height`, undefined, PING_TIMEOUT_MS)
    return
  }
  if (network.walletType === 'solana') {
    const body = await providerPost<{ error?: { message?: string } }>(
      url,
      { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] },
      { timeoutMs: PING_TIMEOUT_MS },
    )
    if (body?.error) throw new Error(body.error.message || 'RPC 返回错误')
    return
  }
  await providerPost(joinRpcPath(url, 'wallet/getnowblock'), {}, { timeoutMs: PING_TIMEOUT_MS })
}

export async function pingRpcNode(id: string): Promise<RpcPingResult> {
  const node = getRpcNode(id)
  if (!node) throw notFound('节点不存在')
  const network = requireNetwork(node.networkPk)
  const started = Date.now()
  try {
    await pingUrl(network, node.url)
    const latencyMs = Date.now() - started
    updateRpcPing(id, { latencyMs, error: null })
    return { id, ok: true, latencyMs, error: null }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    updateRpcPing(id, { latencyMs: null, error })
    return { id, ok: false, latencyMs: null, error }
  }
}

export async function pingAllRpcNodes(networkPk: string): Promise<RpcPingResult[]> {
  const nodes = listRpcNodesForNetwork(networkPk)
  return Promise.all(nodes.map((node) => pingRpcNode(node.id)))
}
