/**
 * 常见链的区块浏览器首页。目录里 browser 经常为空，维护页和链接都回落到这里。
 */
import type { NetworkScope, WalletType } from './types'

const EVM_ORIGINS: Record<string, string> = {
  '1': 'https://etherscan.io',
  '11155111': 'https://sepolia.etherscan.io',
  '42161': 'https://arbiscan.io',
  '421614': 'https://sepolia.arbiscan.io',
  '56': 'https://bscscan.com',
  '97': 'https://testnet.bscscan.com',
  '8453': 'https://basescan.org',
  '84532': 'https://sepolia.basescan.org',
  '10': 'https://optimistic.etherscan.io',
  '137': 'https://polygonscan.com',
  '43114': 'https://snowtrace.io',
  '59144': 'https://lineascan.build',
  '534352': 'https://scrollscan.com',
  '324': 'https://explorer.zksync.io',
  '81457': 'https://blastscan.io',
  '5000': 'https://mantlescan.xyz',
  '3721': 'https://xonescan.com',
}

export function defaultExplorerOrigin(input: {
  walletType: WalletType
  chainId: string
  networkScope: NetworkScope
}): string | null {
  if (input.walletType === 'bitcoin') {
    return input.networkScope === 'testnet' ? 'https://mempool.space/testnet' : 'https://mempool.space'
  }
  if (input.walletType === 'tron') {
    return input.networkScope === 'testnet' ? 'https://nile.tronscan.org' : 'https://tronscan.org'
  }
  if (input.walletType === 'solana') {
    return input.networkScope === 'testnet' ? 'https://solscan.io?cluster=devnet' : 'https://solscan.io'
  }
  return EVM_ORIGINS[input.chainId.trim()] ?? null
}

export function resolveNetworkBrowser(network: {
  browser?: string | null
  walletType: WalletType
  chainId: string
  networkScope: NetworkScope
}): string {
  const current = network.browser?.trim() ?? ''
  return current || defaultExplorerOrigin(network) || ''
}
