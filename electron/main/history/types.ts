export interface HistoryTxDraft {
  txid: string
  direction: 'send' | 'receive'
  fromAddress: string
  toAddress: string
  amountMinor: bigint
  decimals: number
  symbol: string
  contractAddress: string | null
  feeMinor: bigint | null
  status: 'pending' | 'confirmed' | 'failed'
  blockHeight: number | null
  timestampMs: number
}

export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
