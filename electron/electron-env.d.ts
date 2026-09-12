/// <reference types="vite-plugin-electron/electron-env" />

interface ImportMetaEnv {
  readonly VITE_CATALOG_BASE_URL?: string
  /** 兼容旧名，等同 VITE_CATALOG_BASE_URL */
  readonly VITE_API_BASE_URL?: string
  readonly VITE_INFURA_API_KEY?: string
  readonly VITE_INFURA_PROJECT_ID?: string
  readonly VITE_BTC_MAINNET_API?: string
  readonly VITE_BTC_TESTNET_API?: string
  readonly VITE_TRON_MAINNET_API?: string
  readonly VITE_TRON_TESTNET_API?: string
  readonly VITE_TRONGRID_API_KEY?: string
  readonly VITE_ETHERSCAN_API_KEY?: string
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  readonly WALLET_CONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  beeWallet: import('./preload').BeeWalletBridge
}

declare module 'ws' {
  const WebSocket: {
    new (url: string | URL, protocols?: string | string[], options?: object): import('node:events').EventEmitter
  }
  export default WebSocket
}
