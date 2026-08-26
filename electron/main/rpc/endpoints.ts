/**
 * 把网络目录里的 rpcUrl 解析成钱包本机直连的绝对地址。
 * 相对路径 / 公司代理路径一律丢掉，改用 .env 里的 Infura / Esplora / TronGrid。
 */
import type { NetworkRecord, NetworkScope } from '../../../shared/types'
import { bitcoinApiBase, infuraApiKey, tronApiBase } from './env'

/** Infura 子域。chainId 用十进制。 */
const INFURA_BY_CHAIN_ID: Record<string, string> = {
  '1': 'mainnet',
  '11155111': 'sepolia',
  '59144': 'linea-mainnet',
  '59141': 'linea-sepolia',
  '137': 'polygon-mainnet',
  '80002': 'polygon-amoy',
  '42161': 'arbitrum-mainnet',
  '421614': 'arbitrum-sepolia',
  '10': 'optimism-mainnet',
  '11155420': 'optimism-sepolia',
  '8453': 'base-mainnet',
  '84532': 'base-sepolia',
  '43114': 'avalanche-mainnet',
  '43113': 'avalanche-fuji',
  '56': 'bsc-mainnet',
  '97': 'bsc-testnet',
  '324': 'zksync-mainnet',
  '300': 'zksync-sepolia',
  '534352': 'scroll-mainnet',
  '534351': 'scroll-sepolia',
  '81457': 'blast-mainnet',
  '168587773': 'blast-sepolia',
  '42220': 'celo-mainnet',
  '11297108109': 'palm-mainnet',
  '11297108099': 'palm-testnet',
  '1329': 'sei-mainnet',
  '1328': 'sei-testnet',
}

export function normalizeChainId(chainId: string): string {
  const trimmed = chainId.trim()
  if (!trimmed) return ''
  if (/^0x/i.test(trimmed)) return String(Number.parseInt(trimmed, 16))
  const asNumber = Number(trimmed)
  return Number.isFinite(asNumber) ? String(asNumber) : trimmed
}

function substituteInfura(url: string, key: string): string {
  let next = url.replace(/\{INFURA_API_KEY\}/g, key).replace(/\{INFURA_PROJECT_ID\}/g, key)
  if (key && /infura\.io\/v3\/?$/i.test(next.replace(/\/+$/, ''))) {
    next = `${next.replace(/\/+$/, '')}/${key}`
  }
  return next
}

export function resolveEvmRpcUrl(network: NetworkRecord): string {
  const key = infuraApiKey()
  const raw = network.rpcUrl?.trim() ?? ''
  if (/^https?:\/\//i.test(raw)) {
    const resolved = substituteInfura(raw, key)
    if (/infura\.io\/v3\/?$/i.test(resolved.replace(/\/+$/, '')) && !key) {
      throw new Error('目录里的 Infura RPC 需要配置 VITE_INFURA_API_KEY')
    }
    return resolved
  }

  const chainId = normalizeChainId(network.chainId)
  const infuraName = INFURA_BY_CHAIN_ID[chainId]
  if (infuraName && key) {
    return `https://${infuraName}.infura.io/v3/${key}`
  }
  if (infuraName && !key) {
    throw new Error('未配置 VITE_INFURA_API_KEY，无法连接该 EVM 网络')
  }
  throw new Error(
    `网络 ${network.networkName || chainId} 没有可用的 RPC。请在目录里提供 https rpcUrl，或在 .env 配置 Infura key`,
  )
}

export function resolveBitcoinApiBase(scope: NetworkScope): string {
  return bitcoinApiBase(scope)
}

export function resolveTronApiBase(scope: NetworkScope): string {
  return tronApiBase(scope)
}
