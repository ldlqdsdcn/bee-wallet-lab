/**
 * 添加网络时查询「网络 + 主币 + 热门代币」。
 *
 * 目录站约定（设置里填了 baseUrl 才会请求，失败回落到本地预设）：
 *   GET {baseUrl}/api/network/lookup?chainId=8453
 *   GET {baseUrl}/api/network/lookup?q=base
 *
 * 响应建议（也兼容包在 { success, data } 里，client 会先 unwrap）：
 * {
 *   supported: true,
 *   network: { 与 /api/network 列表项相同的字段 },
 *   native:  { 与 /api/token 相同，isToken=N / 合约空 },
 *   tokens:  [ 热门合约代币 ]
 * }
 */
import type {
  CatalogLookupQuery,
  CatalogLookupResult,
  CatalogLookupToken,
  NetworkUpsertInput,
} from '@shared/types'
import { matchNetworkPreset, type NetworkPreset, type PresetToken } from '@shared/networkPresets'
import { asRecord, asString, extractList } from '../backend/list'
import { catalogGet } from '../backend/client'
import { getBaseUrl } from '../backend/config'
import { mapNetwork, mapToken } from './map'

const LOOKUP_PATH = '/api/network/lookup'
const LOOKUP_TIMEOUT_MS = 5_000

function emptyResult(source: CatalogLookupResult['source']): CatalogLookupResult {
  return { source, supported: true, hint: null, network: null, native: null, tokens: [] }
}

function networkToInput(preset: NetworkPreset): NetworkUpsertInput {
  return {
    networkName: preset.networkName,
    walletType: preset.walletType,
    networkScope: preset.networkScope,
    chainId: preset.chainId,
    chainName: preset.chainName,
    rpcUrl: preset.rpcUrl,
    browser: preset.browser,
    coinId: preset.coinId ?? '',
    coinEasy: preset.coinEasy,
  }
}

function nativeFromPreset(preset: NetworkPreset): CatalogLookupToken {
  return {
    name: preset.nativeName,
    symbol: preset.coinEasy,
    decimals: preset.decimals,
    contractAddress: null,
    tokenId: preset.coinId,
    tokenIcon: null,
    isToken: false,
  }
}

function tokenFromPreset(item: PresetToken): CatalogLookupToken {
  return {
    name: item.name,
    symbol: item.symbol,
    decimals: item.decimals,
    contractAddress: item.contractAddress,
    tokenId: item.tokenId ?? null,
    tokenIcon: null,
    isToken: true,
  }
}

export function bundleFromPreset(preset: NetworkPreset): CatalogLookupResult {
  return {
    source: 'local',
    supported: preset.supported,
    hint: preset.hint ?? null,
    network: networkToInput(preset),
    native: nativeFromPreset(preset),
    tokens: (preset.tokens ?? []).map(tokenFromPreset),
  }
}

function lookupTokenFromDto(dto: Record<string, unknown>, networkPk: string, syncedAt: number): CatalogLookupToken | null {
  const mapped = mapToken({ ...dto, id: asString(dto.id, asString(dto.symbol, 't')), tNetworkId: networkPk }, syncedAt)
  if (!mapped) return null
  return {
    name: mapped.name || mapped.symbol,
    symbol: mapped.symbol,
    decimals: mapped.decimals,
    contractAddress: mapped.contractAddress,
    tokenId: mapped.tokenId,
    tokenIcon: mapped.tokenIcon,
    isToken: mapped.isToken,
  }
}

function networkFromMapped(dto: Record<string, unknown>, syncedAt: number): NetworkUpsertInput | null {
  const mapped = mapNetwork(
    { ...dto, id: asString(dto.id, asString(dto.chainId, asString(dto.networkName, 'n'))) },
    syncedAt,
  )
  if (!mapped) return null
  return {
    networkName: mapped.networkName,
    walletType: mapped.walletType,
    networkScope: mapped.networkScope,
    chainId: mapped.chainId,
    chainName: mapped.chainName,
    rpcUrl: mapped.rpcUrl ?? '',
    browser: mapped.browser ?? '',
    coinId: mapped.coinId ?? '',
    coinEasy: mapped.coinEasy ?? '',
    icon: mapped.icon ?? '',
    remark: mapped.remark ?? '',
  }
}

/** 纯函数：把目录站 lookup 响应当成本地结果。供单测。 */
export function parseLookupPayload(payload: unknown, syncedAt = 0): CatalogLookupResult | null {
  const root = asRecord(payload)
  if (!root) return null
  const nested = asRecord(root.data)
  const body = nested && (nested.network || nested.chainId || nested.tokens) ? nested : root
  const networkDto = asRecord(body.network) ?? (asString(body.chainId) || asString(body.networkName) ? body : null)
  if (!networkDto) return null
  const network = networkFromMapped(networkDto, syncedAt)
  if (!network) return null
  const networkPk = asString(networkDto.id, network.chainId || 'net')
  const nativeDto = asRecord(body.native) ?? asRecord(body.nativeToken)
  const listed = extractList<unknown>(body.tokens ?? body.hotTokens ?? body.popularTokens)
  const tokens = listed
    .map((item) => lookupTokenFromDto(asRecord(item) ?? {}, networkPk, syncedAt))
    .filter((item): item is CatalogLookupToken => item !== null)
  const nativeFromList = tokens.find((item) => !item.isToken) ?? null
  const native = nativeDto
    ? lookupTokenFromDto(nativeDto, networkPk, syncedAt)
    : nativeFromList
  const contracts = tokens.filter((item) => item.isToken)
  const supported = body.supported === false ? false : true
  return {
    source: 'remote',
    supported,
    hint: asString(body.hint) || (supported ? null : '目录站标记该网络暂不可用'),
    network,
    native,
    tokens: contracts,
  }
}

function localLookup(query: CatalogLookupQuery): CatalogLookupResult {
  const preset =
    matchNetworkPreset(query.chainId ?? '') ?? matchNetworkPreset(query.q ?? '')
  return preset ? bundleFromPreset(preset) : emptyResult('local')
}

async function remoteLookup(query: CatalogLookupQuery): Promise<CatalogLookupResult | null> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) return null
  const chainId = query.chainId?.trim() ?? ''
  const q = query.q?.trim() ?? ''
  if (!chainId && !q) return null
  try {
    const payload = await catalogGet<unknown>(
      LOOKUP_PATH,
      {
        chainId: chainId || undefined,
        q: q || undefined,
      },
      { timeoutMs: LOOKUP_TIMEOUT_MS },
    )
    return parseLookupPayload(payload)
  } catch {
    return null
  }
}

/** 有目录站先问站；没有或失败用本地预设。 */
export async function lookupCatalogNetwork(query: CatalogLookupQuery): Promise<CatalogLookupResult> {
  const remote = await remoteLookup(query)
  if (remote?.network) return remote
  return localLookup(query)
}
