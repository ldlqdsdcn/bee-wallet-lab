/**
 * 把目录站 /api/network /api/token /api/currency 的 DTO 映射成本地目录记录。
 * 纯函数，便于单测；不触网、不碰数据库。
 */
import type {
  CurrencyRecord,
  NetworkRecord,
  NetworkScope,
  TokenRecord,
  WalletType,
} from '@shared/types'
import { asBooleanFlag, asNumber, asString } from '../backend/list'

const WALLET_TYPES: WalletType[] = ['bitcoin', 'web3', 'tron']

export function inferWalletType(value: unknown): WalletType | null {
  const normalized = asString(value).toLowerCase()
  if (normalized === 'bitcoin' || normalized === 'btc') return 'bitcoin'
  if (normalized === 'tron' || normalized === 'trx') return 'tron'
  if (normalized === 'web3' || normalized === 'evm' || normalized === 'ethereum') return 'web3'
  if (normalized === 'solana') return null
  return normalized ? 'web3' : null
}

export function inferNetworkScope(chainId: string, chainName: string): NetworkScope {
  const blob = `${chainId} ${chainName}`.toLowerCase()
  if (/test|sepolia|goerli|nile|shasta|amoy|fuji|holesky|devnet/.test(blob)) return 'testnet'
  return 'mainnet'
}

export function mapNetwork(dto: Record<string, unknown>, syncedAt: number): NetworkRecord | null {
  const walletType = inferWalletType(dto.type ?? dto.walletType ?? dto.chainType)
  if (!walletType || !WALLET_TYPES.includes(walletType)) return null
  const id = asString(dto.id, asString(dto.networkId))
  if (!id) return null
  const chainId = asString(dto.chainId, asString(dto.chain_id, '0'))
  const chainName = asString(dto.chainName, asString(dto.chain_name))
  return {
    id,
    networkId: asString(dto.networkId, id),
    networkName: asString(dto.networkName, asString(dto.name, walletType)),
    chainId,
    chainName,
    chainType: asString(dto.chainType) || null,
    walletType,
    coinId: asString(dto.coinId) || null,
    coinEasy: asString(dto.coinEasy) || null,
    rpcUrl: asString(dto.rpcUrl) || null,
    browser: asString(dto.browser) || null,
    icon: asString(dto.icon) || null,
    webAddress: asString(dto.webAddress) || null,
    supportGasTime: asString(dto.supportGasTime) || null,
    remark: asString(dto.remark) || null,
    networkScope: inferNetworkScope(chainId, chainName),
    syncedAt,
  }
}

export function mapToken(dto: Record<string, unknown>, syncedAt: number): TokenRecord | null {
  const id = asString(dto.id, asString(dto.tokenId))
  const networkPk = asString(dto.tNetworkId ?? dto.tnetworkId ?? dto.networkId)
  const symbol = asString(dto.symbol).toUpperCase()
  if (!id || !networkPk || !symbol) return null
  const contract = asString(dto.contractAddress)
  const isToken = asBooleanFlag(dto.isToken)
  const nativeContract = !contract || contract === '0' || /^0x0+$/i.test(contract)
  return {
    id,
    tokenId: asString(dto.tokenId) || null,
    name: asString(dto.name) || symbol,
    symbol,
    decimals: asNumber(dto.decimals, 18),
    contractAddress: isToken || !nativeContract ? contract || null : null,
    tokenStandard: asString(dto.tokenStandard) || null,
    isToken: isToken || (!nativeContract && asString(dto.isToken) !== 'N'),
    gasLimit: typeof dto.gasLimit === 'number' ? dto.gasLimit : null,
    networkPk,
    tokenIcon: asString(dto.tokenIcon ?? dto.icon) || null,
    blockchainExplorer: asString(dto.blockchainExplorer) || null,
    isDefaultSelected: asBooleanFlag(dto.isDefaultSelected),
    syncedAt,
  }
}

export function mapCurrency(dto: Record<string, unknown>, syncedAt: number): CurrencyRecord | null {
  const code = asString(dto.currencyTypeCode ?? dto.code).toUpperCase()
  if (!code) return null
  if (dto.isEnable === 0 || dto.isEnable === '0') return null
  return {
    id: asString(dto.id, code),
    code,
    name: asString(dto.currencyTypeName ?? dto.name) || code,
    symbol: asString(dto.currencyTypeUnit ?? dto.symbol) || code,
    syncedAt,
  }
}
