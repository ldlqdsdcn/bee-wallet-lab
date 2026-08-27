/**
 * 常见链预设：添加网络时按名称 / chainId 自动填主币、RPC、浏览器。
 * Sui 等非 Bitcoin/EVM/TRON/Solana 链目前不能真正派生和查余额。
 */
import type { NetworkScope, WalletType } from './types'

export interface NetworkPreset {
  aliases: string[]
  networkName: string
  walletType: WalletType
  networkScope: NetworkScope
  chainId: string
  chainName: string
  coinEasy: string
  nativeName: string
  coinId: string | null
  decimals: number
  rpcUrl: string
  browser: string
  featured?: boolean
  /** false：只能提示，不能写入可用网络 */
  supported: boolean
  hint?: string
  /** 该网络热门合约代币（不含主币）。目录站上线后由接口覆盖。 */
  tokens?: PresetToken[]
}

export interface PresetToken {
  symbol: string
  name: string
  decimals: number
  contractAddress: string
  tokenId?: string | null
}

function usdc(address: string): PresetToken {
  return { symbol: 'USDC', name: 'USD Coin', decimals: 6, contractAddress: address, tokenId: 'usd-coin' }
}

function usdt(address: string): PresetToken {
  return { symbol: 'USDT', name: 'Tether USD', decimals: 6, contractAddress: address, tokenId: 'tether' }
}

export const NETWORK_PRESETS: NetworkPreset[] = [
  {
    aliases: ['base'],
    networkName: 'Base',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '8453',
    chainName: 'Mainnet',
    coinEasy: 'ETH',
    nativeName: 'Ether',
    coinId: 'ethereum',
    decimals: 18,
    rpcUrl: 'https://mainnet.base.org',
    browser: 'https://basescan.org',
    featured: true,
    supported: true,
    tokens: [
      usdc('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
      usdt('0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'),
    ],
  },
  {
    aliases: ['xoc', 'xone', 'xone chain'],
    networkName: 'Xone',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '3721',
    chainName: 'Mainnet',
    coinEasy: 'XOC',
    nativeName: 'Xone Coin',
    coinId: null,
    decimals: 18,
    rpcUrl: 'https://rpc.xone.org',
    browser: 'https://xonescan.com',
    featured: true,
    supported: true,
  },
  {
    aliases: ['op', 'optimism'],
    networkName: 'Optimism',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '10',
    chainName: 'Mainnet',
    coinEasy: 'ETH',
    nativeName: 'Ether',
    coinId: 'ethereum',
    decimals: 18,
    rpcUrl: 'https://mainnet.optimism.io',
    browser: 'https://optimistic.etherscan.io',
    featured: true,
    supported: true,
    tokens: [usdc('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85')],
  },
  {
    aliases: ['polygon', 'matic', 'pol'],
    networkName: 'Polygon',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '137',
    chainName: 'Mainnet',
    coinEasy: 'POL',
    nativeName: 'POL',
    coinId: 'polygon-ecosystem-token',
    decimals: 18,
    rpcUrl: 'https://polygon-rpc.com',
    browser: 'https://polygonscan.com',
    featured: true,
    supported: true,
    tokens: [usdc('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359')],
  },
  {
    aliases: ['linea'],
    networkName: 'Linea',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '59144',
    chainName: 'Mainnet',
    coinEasy: 'ETH',
    nativeName: 'Ether',
    coinId: 'ethereum',
    decimals: 18,
    rpcUrl: 'https://rpc.linea.build',
    browser: 'https://lineascan.build',
    featured: true,
    supported: true,
  },
  {
    aliases: ['scroll'],
    networkName: 'Scroll',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '534352',
    chainName: 'Mainnet',
    coinEasy: 'ETH',
    nativeName: 'Ether',
    coinId: 'ethereum',
    decimals: 18,
    rpcUrl: 'https://rpc.scroll.io',
    browser: 'https://scrollscan.com',
    featured: true,
    supported: true,
  },
  {
    aliases: ['zksync', 'zksync era', 'era'],
    networkName: 'zkSync Era',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '324',
    chainName: 'Mainnet',
    coinEasy: 'ETH',
    nativeName: 'Ether',
    coinId: 'ethereum',
    decimals: 18,
    rpcUrl: 'https://mainnet.era.zksync.io',
    browser: 'https://explorer.zksync.io',
    featured: true,
    supported: true,
  },
  {
    aliases: ['blast'],
    networkName: 'Blast',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '81457',
    chainName: 'Mainnet',
    coinEasy: 'ETH',
    nativeName: 'Ether',
    coinId: 'ethereum',
    decimals: 18,
    rpcUrl: 'https://rpc.blast.io',
    browser: 'https://blastscan.io',
    featured: true,
    supported: true,
  },
  {
    aliases: ['mantle'],
    networkName: 'Mantle',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '5000',
    chainName: 'Mainnet',
    coinEasy: 'MNT',
    nativeName: 'Mantle',
    coinId: 'mantle',
    decimals: 18,
    rpcUrl: 'https://rpc.mantle.xyz',
    browser: 'https://mantlescan.xyz',
    featured: true,
    supported: true,
  },
  {
    aliases: ['avalanche', 'avax', 'c-chain'],
    networkName: 'Avalanche C-Chain',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '43114',
    chainName: 'C-Chain',
    coinEasy: 'AVAX',
    nativeName: 'Avalanche',
    coinId: 'avalanche-2',
    decimals: 18,
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    browser: 'https://snowtrace.io',
    featured: true,
    supported: true,
  },
  {
    aliases: ['opbnb'],
    networkName: 'opBNB',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '204',
    chainName: 'Mainnet',
    coinEasy: 'BNB',
    nativeName: 'BNB',
    coinId: 'binancecoin',
    decimals: 18,
    rpcUrl: 'https://opbnb-mainnet-rpc.bnbchain.org',
    browser: 'https://opbnbscan.com',
    supported: true,
  },
  {
    aliases: ['x layer', 'xlayer', 'okx'],
    networkName: 'X Layer',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '196',
    chainName: 'Mainnet',
    coinEasy: 'OKB',
    nativeName: 'OKB',
    coinId: 'okb',
    decimals: 18,
    rpcUrl: 'https://rpc.xlayer.tech',
    browser: 'https://www.okx.com/web3/explorer/xlayer',
    supported: true,
  },
  {
    aliases: ['sei', 'sei evm'],
    networkName: 'Sei',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: '1329',
    chainName: 'Mainnet',
    coinEasy: 'SEI',
    nativeName: 'Sei',
    coinId: 'sei-network',
    decimals: 18,
    rpcUrl: 'https://evm-rpc.sei-apis.com',
    browser: 'https://seitrace.com',
    supported: true,
  },
  {
    aliases: ['sui'],
    networkName: 'Sui',
    walletType: 'web3',
    networkScope: 'mainnet',
    chainId: 'sui',
    chainName: 'Mainnet',
    coinEasy: 'SUI',
    nativeName: 'Sui',
    coinId: 'sui',
    decimals: 9,
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    browser: 'https://suiscan.xyz',
    featured: true,
    supported: false,
    hint: 'Sui 不是 EVM，当前还没有地址派生和余额查询，不能当 EVM 网添加。',
  },
]

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function numericChainId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 16)
    return Number.isFinite(parsed) ? String(parsed) : null
  }
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed))
  return null
}

export function featuredNetworkPresets(): NetworkPreset[] {
  return NETWORK_PRESETS.filter((item) => item.featured)
}

export function presetByChainId(walletType: WalletType, chainId: string): NetworkPreset | null {
  const numeric = numericChainId(chainId)
  return (
    NETWORK_PRESETS.find((item) => {
      if (!item.supported || item.walletType !== walletType) return false
      if (item.chainId === chainId.trim()) return true
      return numeric != null && item.chainId === numeric
    }) ?? null
  )
}

/** 按 chainId 或名称/别名匹配；名称需整词或别名全等，避免 b 误匹配 blast。 */
export function matchNetworkPreset(query: string): NetworkPreset | null {
  const q = normalizeQuery(query)
  if (!q) return null
  const numeric = numericChainId(q)
  const byChain =
    NETWORK_PRESETS.find((item) => item.chainId === q || (numeric != null && item.chainId === numeric)) ?? null
  if (byChain) return byChain
  const exactAlias = NETWORK_PRESETS.find((item) => item.aliases.some((alias) => alias === q))
  if (exactAlias) return exactAlias
  const exactName = NETWORK_PRESETS.find((item) => item.networkName.toLowerCase() === q)
  if (exactName) return exactName
  return null
}
