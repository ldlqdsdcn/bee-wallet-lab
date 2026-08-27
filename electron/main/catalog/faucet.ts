/**
 * 测试网水龙头维护。本版手动增删；内置项可恢复。后续目录站只覆盖 source=builtin。
 */
import type { FaucetRecord, FaucetUpsertInput, NetworkRecord } from '@shared/types'
import { newId } from '../security/crypto'
import { getNetwork, listNetworks } from '../db/repos/catalogRepo'
import {
  deleteBuiltinFaucets,
  deleteFaucet,
  findFaucet,
  getFaucet,
  insertFaucet,
  listFaucets,
  nextFaucetSortOrder,
  updateFaucet,
} from '../db/repos/faucetRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { builtinFaucetsFor, normalizeFaucetUrl } from './faucetPresets'

function requireNetwork(networkPk: string): NetworkRecord {
  const network = getNetwork(networkPk)
  if (!network) throw notFound('网络不存在')
  return network
}

function requireTestnet(network: NetworkRecord): void {
  if (network.networkScope !== 'testnet') {
    throw invalidArg('只有测试网可以配置水龙头')
  }
}

function parseUrl(raw: string): string {
  try {
    return normalizeFaucetUrl(raw)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : '水龙头地址无效')
  }
}

function labelOf(url: string, fallback?: string | null): string | null {
  const trimmed = fallback?.trim() ?? ''
  if (trimmed) return trimmed
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function ensureFaucetsSeeded(network: NetworkRecord): void {
  if (network.networkScope !== 'testnet') return
  if (listFaucets(network.id).length > 0) return
  seedMissingBuiltins(network)
}

function seedMissingBuiltins(network: NetworkRecord): void {
  const existing = new Set(listFaucets(network.id).map((item) => item.url))
  for (const preset of builtinFaucetsFor(network)) {
    const url = normalizeFaucetUrl(preset.url)
    if (existing.has(url)) continue
    insertFaucet({
      id: newId(),
      networkPk: network.id,
      url,
      label: preset.label,
      source: 'builtin',
      sortOrder: nextFaucetSortOrder(network.id),
    })
    existing.add(url)
  }
}

export function seedFaucetsForCatalog(): void {
  for (const network of listNetworks()) ensureFaucetsSeeded(network)
}

export function listFaucetsForNetwork(networkPk: string): FaucetRecord[] {
  const network = requireNetwork(networkPk)
  ensureFaucetsSeeded(network)
  if (network.networkScope !== 'testnet') return []
  return listFaucets(networkPk)
}

export function upsertFaucet(input: FaucetUpsertInput): FaucetRecord {
  const network = requireNetwork(input.networkPk)
  requireTestnet(network)
  ensureFaucetsSeeded(network)
  const url = parseUrl(input.url)
  const existing = input.id ? getFaucet(input.id) : null
  if (input.id && !existing) throw notFound('水龙头不存在')
  if (existing && existing.networkPk !== network.id) throw invalidArg('不能改到别的网络')
  const conflict = findFaucet(network.id, url)
  if (conflict && conflict.id !== existing?.id) throw invalidArg('该水龙头已经添加过')
  const label = labelOf(url, input.label)
  if (existing) return updateFaucet({ id: existing.id, url, label })
  return insertFaucet({
    id: newId(),
    networkPk: network.id,
    url,
    label,
    source: 'custom',
    sortOrder: nextFaucetSortOrder(network.id),
  })
}

export function removeFaucet(id: string): true {
  const existing = getFaucet(id)
  if (!existing) throw notFound('水龙头不存在')
  deleteFaucet(id)
  return true
}

export function restoreBuiltinFaucets(networkPk: string): FaucetRecord[] {
  const network = requireNetwork(networkPk)
  requireTestnet(network)
  deleteBuiltinFaucets(network.id)
  seedMissingBuiltins(network)
  return listFaucets(network.id)
}
