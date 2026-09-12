/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CATALOG_BASE_URL?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_INFURA_API_KEY?: string
  readonly VITE_INFURA_PROJECT_ID?: string
  readonly VITE_BTC_MAINNET_API?: string
  readonly VITE_BTC_TESTNET_API?: string
  readonly VITE_TRON_MAINNET_API?: string
  readonly VITE_TRON_TESTNET_API?: string
  readonly VITE_TRONGRID_API_KEY?: string
  readonly VITE_SOLANA_MAINNET_RPC?: string
  readonly VITE_SOLANA_DEVNET_RPC?: string
  readonly VITE_COINGECKO_API_KEY?: string
  readonly VITE_ETHERSCAN_API_KEY?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  readonly WALLET_CONNECT_PROJECT_ID?: string
}
