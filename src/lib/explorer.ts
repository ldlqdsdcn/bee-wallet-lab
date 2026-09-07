import type { NetworkRecord } from '@shared/types'

/** 按 chainId 的地址页模板；目录里 browser 经常为空。 */
const EVM_ADDRESS_URL: Record<string, string> = {
  '1': 'https://etherscan.io/address/{address}',
  '11155111': 'https://sepolia.etherscan.io/address/{address}',
  '42161': 'https://arbiscan.io/address/{address}',
  '421614': 'https://sepolia.arbiscan.io/address/{address}',
  '56': 'https://bscscan.com/address/{address}',
  '97': 'https://testnet.bscscan.com/address/{address}',
  '8453': 'https://basescan.org/address/{address}',
  '84532': 'https://sepolia.basescan.org/address/{address}',
  '10': 'https://optimistic.etherscan.io/address/{address}',
  '137': 'https://polygonscan.com/address/{address}',
  '43114': 'https://snowtrace.io/address/{address}',
  '59144': 'https://lineascan.build/address/{address}',
  '534352': 'https://scrollscan.com/address/{address}',
  '324': 'https://explorer.zksync.io/address/{address}',
  '81457': 'https://blastscan.io/address/{address}',
  '5000': 'https://mantlescan.xyz/address/{address}',
  '3721': 'https://xonescan.com/address/{address}',
}

function fill(template: string, address: string): string {
  return template.replace(/\{address\}/g, address)
}

function fromBrowserField(browser: string, walletType: NetworkRecord['walletType'], address: string): string {
  const base = browser.trim().replace(/\/+$/, '')
  if (walletType === 'tron') return `${base}/#/address/${address}`
  if (walletType === 'bitcoin' && /blockcypher\.com/i.test(base)) {
    return `${base}/btc/address/${address}`
  }
  return `${base}/address/${address}`
}

/** 账户在区块链浏览器中的地址页；拼不出时返回 null。 */
export function addressExplorerUrl(network: NetworkRecord, address: string): string | null {
  const value = address.trim()
  if (!value) return null

  if (network.walletType === 'bitcoin') {
    return network.networkScope === 'testnet'
      ? `https://mempool.space/testnet/address/${value}`
      : `https://mempool.space/address/${value}`
  }
  if (network.walletType === 'tron') {
    return network.networkScope === 'testnet'
      ? `https://nile.tronscan.org/#/address/${value}`
      : `https://tronscan.org/#/address/${value}`
  }
  if (network.walletType === 'solana') {
    const cluster = network.networkScope === 'testnet' ? '?cluster=devnet' : ''
    return `https://solscan.io/account/${value}${cluster}`
  }

  const known = EVM_ADDRESS_URL[network.chainId]
  if (known) return fill(known, value)
  if (network.browser) return fromBrowserField(network.browser, network.walletType, value)
  return null
}

export function txExplorerUrl(network: NetworkRecord, txid: string): string | null {
  const value = txid.trim()
  if (!value) return null
  if (network.walletType === 'bitcoin') {
    return network.networkScope === 'testnet'
      ? `https://mempool.space/testnet/tx/${value}`
      : `https://mempool.space/tx/${value}`
  }
  if (network.walletType === 'tron') {
    return network.networkScope === 'testnet'
      ? `https://nile.tronscan.org/#/transaction/${value}`
      : `https://tronscan.org/#/transaction/${value}`
  }
  if (network.walletType === 'solana') {
    const cluster = network.networkScope === 'testnet' ? '?cluster=devnet' : ''
    return `https://solscan.io/tx/${value}${cluster}`
  }
  const addressUrl = addressExplorerUrl(network, '__ADDR__')
  if (addressUrl?.includes('/address/__ADDR__')) return addressUrl.replace('/address/__ADDR__', `/tx/${value}`)
  if (network.browser) return `${network.browser.replace(/\/+$/, '')}/tx/${value}`
  return null
}

export function explorerTabTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '浏览器'
  }
}
