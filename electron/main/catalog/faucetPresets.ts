/**
 * 测试网水龙头本地预设。主网没有水龙头。
 * 后续目录站可按同样 shape 下发，upsert source=builtin，自定义行保留。
 */
import type { NetworkRecord } from '@shared/types'
import { normalizeChainId } from '../rpc/endpoints'

export interface FaucetPreset {
  url: string
  label: string
}

const PRESETS: Record<string, FaucetPreset[]> = {
  'bitcoin:Testnet': [
    { url: 'https://coinfaucet.eu/en/btc-testnet', label: 'Coinfaucet' },
    { url: 'https://bitcoinfaucet.uo1.net', label: 'UO1 Bitcoin Faucet' },
  ],
  'web3:11155111': [
    { url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia', label: 'Google Cloud Sepolia' },
    { url: 'https://www.alchemy.com/faucets/ethereum-sepolia', label: 'Alchemy Sepolia' },
    { url: 'https://faucet.quicknode.com/ethereum/sepolia', label: 'QuickNode Sepolia' },
  ],
  'web3:421614': [
    { url: 'https://www.alchemy.com/faucets/arbitrum-sepolia', label: 'Alchemy Arbitrum Sepolia' },
    { url: 'https://faucet.quicknode.com/arbitrum/sepolia', label: 'QuickNode Arbitrum Sepolia' },
  ],
  'web3:97': [
    { url: 'https://www.bnbchain.org/en/testnet-faucet', label: 'BNB Chain Testnet Faucet' },
  ],
  'web3:84532': [
    { url: 'https://www.alchemy.com/faucets/base-sepolia', label: 'Alchemy Base Sepolia' },
    { url: 'https://faucet.quicknode.com/base/sepolia', label: 'QuickNode Base Sepolia' },
    { url: 'https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet', label: 'Coinbase Base Sepolia' },
  ],
  'tron:1029': [{ url: 'https://nileex.io/join/getJoinPage', label: 'Nileex' }],
  'solana:devnet': [{ url: 'https://faucet.solana.com', label: 'Solana Faucet' }],
}

export function normalizeFaucetUrl(raw: string): string {
  const trimmed = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('水龙头地址无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 水龙头')
  }
  parsed.hash = ''
  return parsed.toString().replace(/\/+$/, '')
}

function presetKey(network: Pick<NetworkRecord, 'walletType' | 'chainId'>): string {
  const chainId =
    network.walletType === 'web3' ? normalizeChainId(network.chainId) : network.chainId.trim()
  return `${network.walletType}:${chainId}`
}

export function builtinFaucetsFor(
  network: Pick<NetworkRecord, 'walletType' | 'chainId' | 'networkScope'>,
): FaucetPreset[] {
  if (network.networkScope !== 'testnet') return []
  return PRESETS[presetKey(network)] ?? []
}
