/**
 * 用户维护网络 / 代币。自定义行在目录同步时保留。
 */
import type {
  CatalogLookupResult,
  CatalogLookupToken,
  NetworkRecord,
  NetworkScope,
  NetworkUpsertInput,
  TokenRecord,
  TokenUpsertInput,
  WalletType,
} from '@shared/types'
import { defaultNativeDecimals, defaultNativeSymbol } from './map'
import { lookupCatalogNetwork } from './lookup'
import { newId } from '../security/crypto'
import {
  deleteNetwork,
  deleteToken,
  deleteTokensByNetwork,
  findNetworkByChain,
  getNetwork,
  getToken,
  insertNetwork,
  insertToken,
  listNetworks,
  listTokens,
  nextNetworkSortOrder,
  nextTokenSortOrder,
  updateNetwork,
  updateToken,
} from '../db/repos/catalogRepo'
import { deleteBalancesForNetwork, deleteBalancesForToken } from '../db/repos/balanceRepo'
import { deleteRpcNodesByNetwork } from '../db/repos/rpcNodeRepo'
import { loadSettings, saveSettings } from '../db/repos/metaRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { ensureRpcSeeded } from '../rpc/nodes'
import { setPreferredRpc } from '../rpc/preference'
import { normalizeChainId } from '../rpc/endpoints'

const WALLET_TYPES: WalletType[] = ['bitcoin', 'web3', 'tron', 'solana']
const SCOPES: NetworkScope[] = ['mainnet', 'testnet']

function trimOrNull(value: string | undefined | null): string | null {
  const next = value?.trim() ?? ''
  return next ? next : null
}

function requireWalletType(value: unknown): WalletType {
  if (typeof value !== 'string' || !WALLET_TYPES.includes(value as WalletType)) {
    throw invalidArg('链类型无效')
  }
  return value as WalletType
}

function requireScope(value: unknown): NetworkScope {
  if (typeof value !== 'string' || !SCOPES.includes(value as NetworkScope)) {
    throw invalidArg('主网/测试网无效')
  }
  return value as NetworkScope
}

function normalizeStoredChainId(walletType: WalletType, raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw invalidArg('chainId 不能为空')
  if (walletType === 'web3') {
    const normalized = normalizeChainId(trimmed)
    if (!normalized) throw invalidArg('chainId 无效')
    return normalized
  }
  return trimmed
}

function nativeContractKey(contract: string | null): string {
  return contract ? contract.toLowerCase() : ''
}

function findTokenConflict(networkPk: string, contract: string | null, excludeId?: string): TokenRecord | null {
  const key = nativeContractKey(contract)
  return (
    listTokens(networkPk).find((item) => {
      if (excludeId && item.id === excludeId) return false
      return nativeContractKey(item.contractAddress) === key
    }) ?? null
  )
}

function defaultTokenStandard(walletType: WalletType, isToken: boolean): string | null {
  if (!isToken) return null
  if (walletType === 'web3') return 'ERC20'
  if (walletType === 'tron') return 'TRC20'
  if (walletType === 'solana') return 'SPL'
  return null
}

function normalizeContract(walletType: WalletType, raw: string | undefined): string | null {
  const value = raw?.trim() ?? ''
  if (!value || value === '0' || /^0x0+$/i.test(value)) return null
  if (walletType === 'bitcoin') throw invalidArg('Bitcoin 不支持合约代币')
  if (walletType === 'web3') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw invalidArg('EVM 合约地址无效')
    return value
  }
  if (walletType === 'tron') {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) throw invalidArg('TRON 合约地址无效')
    return value
  }
  if (value.length < 32 || value.length > 44) throw invalidArg('Solana mint 地址无效')
  return value
}

function nativeMeta(
  network: NetworkRecord,
  bundle: CatalogLookupResult | null,
): { symbol: string; decimals: number; tokenId: string | null; name: string } {
  if (bundle?.native) {
    return {
      symbol: bundle.native.symbol,
      decimals: bundle.native.decimals,
      tokenId: bundle.native.tokenId,
      name: bundle.native.name,
    }
  }
  const symbol = defaultNativeSymbol(network.walletType, network.coinEasy)
  return {
    symbol,
    decimals: defaultNativeDecimals(network.walletType),
    tokenId: network.coinId,
    name: symbol,
  }
}

function seedNativeToken(network: NetworkRecord, bundle: CatalogLookupResult | null = null): void {
  if (findTokenConflict(network.id, null)) return
  const meta = nativeMeta(network, bundle)
  insertToken(
    {
      id: newId(),
      tokenId: meta.tokenId,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      contractAddress: null,
      tokenStandard: null,
      isToken: false,
      gasLimit: network.walletType === 'web3' ? 21_000 : null,
      networkPk: network.id,
      tokenIcon: network.icon,
      blockchainExplorer: network.browser,
      isDefaultSelected: true,
      source: network.source === 'builtin' ? 'builtin' : 'custom',
      syncedAt: Date.now(),
    },
    nextTokenSortOrder(network.id),
  )
}

function seedCatalogToken(network: NetworkRecord, token: CatalogLookupToken): void {
  if (!token.isToken) return
  let contract: string | null
  try {
    contract = normalizeContract(network.walletType, token.contractAddress ?? undefined)
  } catch {
    return
  }
  if (!contract || findTokenConflict(network.id, contract)) return
  insertToken(
    {
      id: newId(),
      tokenId: token.tokenId,
      name: token.name,
      symbol: token.symbol.toUpperCase(),
      decimals: token.decimals,
      contractAddress: contract,
      tokenStandard: defaultTokenStandard(network.walletType, true),
      isToken: true,
      gasLimit: null,
      networkPk: network.id,
      tokenIcon: token.tokenIcon,
      blockchainExplorer: network.browser,
      isDefaultSelected: false,
      source: 'custom',
      syncedAt: Date.now(),
    },
    nextTokenSortOrder(network.id),
  )
}

function toNetworkRecord(
  input: NetworkUpsertInput,
  existing: NetworkRecord | undefined,
  bundle: CatalogLookupResult | null,
): NetworkRecord {
  if (bundle && !bundle.supported) {
    throw invalidArg(bundle.hint ?? '暂不支持该网络')
  }
  const catalog = bundle?.network
  const walletType = requireWalletType(input.walletType || catalog?.walletType)
  if (catalog && catalog.walletType !== walletType) {
    throw invalidArg(`「${catalog.networkName}」的链类型与当前选择不一致`)
  }
  const networkScope = requireScope(input.networkScope ?? catalog?.networkScope)
  const networkName = (input.networkName.trim() || catalog?.networkName || '').trim()
  if (!networkName) throw invalidArg('网络名称不能为空')
  const chainId = normalizeStoredChainId(walletType, input.chainId.trim() || catalog?.chainId || '')
  const dup = findNetworkByChain(walletType, chainId)
  if (dup && dup.id !== existing?.id) throw invalidArg('已存在相同链类型和 chainId 的网络')
  const chainName =
    trimOrNull(input.chainName) ??
    trimOrNull(catalog?.chainName) ??
    (networkScope === 'testnet' ? 'Testnet' : 'Mainnet')
  const coinEasy =
    trimOrNull(input.coinEasy)?.toUpperCase() ??
    trimOrNull(catalog?.coinEasy)?.toUpperCase() ??
    bundle?.native?.symbol ??
    defaultNativeSymbol(walletType, null)
  const now = Date.now()
  return {
    id: existing?.id ?? newId(),
    networkId: existing?.networkId ?? `${walletType}-${chainId}`.toLowerCase(),
    networkName,
    chainId,
    chainName,
    chainType: existing?.chainType ?? (networkScope === 'testnet' ? '2' : '1'),
    walletType,
    coinId: trimOrNull(input.coinId) ?? existing?.coinId ?? trimOrNull(catalog?.coinId) ?? bundle?.native?.tokenId ?? null,
    coinEasy,
    rpcUrl: trimOrNull(input.rpcUrl) ?? trimOrNull(catalog?.rpcUrl) ?? null,
    browser: trimOrNull(input.browser) ?? trimOrNull(catalog?.browser) ?? null,
    icon: trimOrNull(input.icon) ?? existing?.icon ?? trimOrNull(catalog?.icon) ?? null,
    webAddress: existing?.webAddress ?? null,
    supportGasTime: existing?.supportGasTime ?? (walletType === 'web3' ? 'Y' : 'N'),
    remark: trimOrNull(input.remark),
    networkScope,
    source: existing?.source ?? 'custom',
    syncedAt: now,
  }
}

export async function upsertCatalogNetwork(input: NetworkUpsertInput): Promise<NetworkRecord> {
  const existing = input.id ? getNetwork(input.id) : null
  if (input.id && !existing) throw notFound('网络不存在')
  const bundle = await lookupCatalogNetwork({ q: input.networkName, chainId: input.chainId })
  const record = toNetworkRecord(input, existing ?? undefined, bundle)
  if (existing) updateNetwork(record)
  else insertNetwork(record, nextNetworkSortOrder())
  seedNativeToken(record, bundle)
  if (!existing) {
    for (const token of bundle.tokens) seedCatalogToken(record, token)
  }
  const saved = getNetwork(record.id)
  if (!saved) throw notFound('网络写入失败')
  ensureRpcSeeded(saved)
  return saved
}

export function ensureMissingNativeTokens(): void {
  for (const network of listNetworks()) seedNativeToken(network)
}

export function removeCatalogNetwork(id: string): true {
  const existing = getNetwork(id)
  if (!existing) throw notFound('网络不存在')
  deleteTokensByNetwork(id)
  deleteRpcNodesByNetwork(id)
  deleteBalancesForNetwork(id)
  deleteNetwork(id)
  setPreferredRpc(id, null)
  const settings = loadSettings()
  if (settings.defaultNetworkPk === id) {
    const next = listNetworks()[0]
    saveSettings({ defaultNetworkPk: next?.id ?? null })
  }
  return true
}

export function upsertCatalogToken(input: TokenUpsertInput): TokenRecord {
  const network = getNetwork(input.networkPk)
  if (!network) throw notFound('网络不存在')
  const existing = input.id ? getToken(input.id) : null
  if (input.id && !existing) throw notFound('代币不存在')
  const symbol = input.symbol.trim().toUpperCase()
  if (!symbol) throw invalidArg('代币符号不能为空')
  const contract = normalizeContract(network.walletType, input.contractAddress)
  if (findTokenConflict(network.id, contract, existing?.id)) {
    throw invalidArg(contract ? '该合约已经添加过' : '该网络已有原生币')
  }
  const isToken = Boolean(contract)
  const decimalsRaw = input.decimals
  const decimals =
    typeof decimalsRaw === 'number' && Number.isFinite(decimalsRaw)
      ? Math.trunc(decimalsRaw)
      : isToken
        ? 18
        : defaultNativeDecimals(network.walletType)
  if (decimals < 0 || decimals > 30) throw invalidArg('精度无效')
  const now = Date.now()
  const record: TokenRecord = {
    id: existing?.id ?? newId(),
    tokenId: trimOrNull(input.tokenId) ?? existing?.tokenId ?? null,
    name: trimOrNull(input.name) ?? symbol,
    symbol,
    decimals,
    contractAddress: contract,
    tokenStandard: trimOrNull(input.tokenStandard) ?? defaultTokenStandard(network.walletType, isToken),
    isToken,
    gasLimit: typeof input.gasLimit === 'number' ? input.gasLimit : (existing?.gasLimit ?? null),
    networkPk: network.id,
    tokenIcon: trimOrNull(input.tokenIcon) ?? existing?.tokenIcon ?? null,
    blockchainExplorer: existing?.blockchainExplorer ?? network.browser,
    isDefaultSelected: input.isDefaultSelected ?? existing?.isDefaultSelected ?? false,
    source: existing?.source ?? 'custom',
    syncedAt: now,
  }
  if (existing) updateToken(record)
  else insertToken(record, nextTokenSortOrder(network.id))
  const saved = getToken(record.id)
  if (!saved) throw notFound('代币写入失败')
  return saved
}

export function removeCatalogToken(id: string): true {
  const existing = getToken(id)
  if (!existing) throw notFound('代币不存在')
  deleteBalancesForToken(id)
  deleteToken(id)
  return true
}
