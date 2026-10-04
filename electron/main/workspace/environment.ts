/** Only application configuration is portable; never import arbitrary process variables. */
export const ENV_KEYS = [
  'VITE_CATALOG_BASE_URL', 'VITE_API_BASE_URL', 'VITE_INFURA_API_KEY', 'VITE_INFURA_PROJECT_ID',
  'VITE_BTC_MAINNET_API', 'VITE_BTC_TESTNET_API', 'VITE_TRON_MAINNET_API', 'VITE_TRON_TESTNET_API',
  'VITE_SOLANA_MAINNET_RPC', 'VITE_SOLANA_DEVNET_RPC', 'VITE_TRONGRID_API_KEY',
  'VITE_COINGECKO_API_KEY', 'VITE_ETHERSCAN_API_KEY', 'VITE_WALLETCONNECT_PROJECT_ID',
  'WALLET_CONNECT_PROJECT_ID', 'WALLET_CONNECT_RELAY_URL',
] as const

let workspaceEnvironment: Record<string, string> | null = null

export function setWorkspaceEnvironment(values: Record<string, string>): void {
  workspaceEnvironment = { ...values }
}

export function readEnvironment(name: string): string {
  // Missing values in an opened workspace must not fall back to this computer's keys.
  if (workspaceEnvironment) return workspaceEnvironment[name]?.trim() ?? ''
  const value = (import.meta.env as Record<string, unknown>)[name] ?? process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function seedEnvironment(): Record<string, string> {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, readEnvironment(key)]))
}

export function validateEnvironment(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace environment')
  const entries = Object.entries(value)
  if (entries.some(([key, val]) => !(ENV_KEYS as readonly string[]).includes(key) || typeof val !== 'string')) {
    throw new Error('Invalid workspace environment entries')
  }
  return Object.fromEntries(entries) as Record<string, string>
}
