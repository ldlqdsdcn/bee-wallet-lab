function read(name: string): string {
  const fromMeta = (import.meta.env as Record<string, unknown>)[name]
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim()
  const fromProc = process.env[name]
  return typeof fromProc === 'string' ? fromProc.trim() : ''
}

export function walletConnectProjectId(): string {
  return read('WALLET_CONNECT_PROJECT_ID') || read('VITE_WALLETCONNECT_PROJECT_ID')
}

/** 与 OneWallet 一致：Reown 中继。默认 relay.walletconnect.com 配对后收不到提案。 */
export function walletConnectRelayUrl(): string {
  return read('WALLET_CONNECT_RELAY_URL') || 'wss://relay.reown.com'
}
