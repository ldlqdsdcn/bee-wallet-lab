import { readEnvironment as read } from '../workspace/environment'

export function walletConnectProjectId(): string {
  return read('WALLET_CONNECT_PROJECT_ID') || read('VITE_WALLETCONNECT_PROJECT_ID')
}

/** 与 OneWallet 一致，用官方中继。relay.reown.com 上断开后再连经常收不到提案。 */
export function walletConnectRelayUrl(): string {
  return read('WALLET_CONNECT_RELAY_URL') || 'wss://relay.walletconnect.org'
}
