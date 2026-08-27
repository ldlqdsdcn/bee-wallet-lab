/**
 * 从 Vite 注入的 import.meta.env 读配置。只有 VITE_ 前缀会进包。
 */
function read(name: keyof ImportMetaEnv): string {
  const raw = import.meta.env[name]
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 目录站 origin。兼容旧变量名 VITE_API_BASE_URL */
export function catalogEnvUrl(): string {
  const url = read('VITE_CATALOG_BASE_URL') || read('VITE_API_BASE_URL')
  return url.replace(/\/+$/, '')
}

export function infuraApiKey(): string {
  return read('VITE_INFURA_API_KEY') || read('VITE_INFURA_PROJECT_ID')
}

export function bitcoinApiBase(scope: 'mainnet' | 'testnet'): string {
  const fromEnv =
    scope === 'mainnet' ? read('VITE_BTC_MAINNET_API') : read('VITE_BTC_TESTNET_API')
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return scope === 'mainnet'
    ? 'https://blockstream.info/api'
    : 'https://blockstream.info/testnet/api'
}

export function tronApiBase(scope: 'mainnet' | 'testnet'): string {
  const fromEnv =
    scope === 'mainnet' ? read('VITE_TRON_MAINNET_API') : read('VITE_TRON_TESTNET_API')
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return scope === 'mainnet' ? 'https://api.trongrid.io' : 'https://nile.trongrid.io'
}

export function solanaRpcBase(scope: 'mainnet' | 'testnet'): string {
  const fromEnv = scope === 'mainnet' ? read('VITE_SOLANA_MAINNET_RPC') : read('VITE_SOLANA_DEVNET_RPC')
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  return scope === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'
}

export function trongridApiKey(): string {
  return read('VITE_TRONGRID_API_KEY')
}

export function coingeckoApiKey(): string {
  return read('VITE_COINGECKO_API_KEY')
}

export function etherscanApiKey(): string {
  return read('VITE_ETHERSCAN_API_KEY')
}
