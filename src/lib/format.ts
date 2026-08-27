export function shorten(address: string, head = 10, tail = 8): string {
  if (address.length <= head + tail + 1) return address
  return `${address.slice(0, head)}…${address.slice(-tail)}`
}

export function formatAmount(value: string | null | undefined, max = 8): string {
  if (!value) return '0'
  const [whole, fraction = ''] = value.split('.')
  if (!fraction) return whole
  const trimmed = fraction.slice(0, max).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

/** 最小单位字符串 -> 可读金额 */
export function fromMinor(amount: string, decimals: number): string {
  try {
    const value = BigInt(amount || '0')
    const negative = value < 0n
    const abs = negative ? -value : value
    if (decimals <= 0) return `${negative ? '-' : ''}${abs.toString()}`
    const raw = abs.toString().padStart(decimals + 1, '0')
    return formatAmount(`${negative ? '-' : ''}${raw.slice(0, -decimals)}.${raw.slice(-decimals)}`, Math.min(decimals, 8))
  } catch {
    return amount || '0'
  }
}

export function walletTypeLabel(type: string): string {
  if (type === 'web3') return 'EVM'
  if (type === 'tron') return 'TRON'
  if (type === 'solana') return 'Solana'
  return 'Bitcoin'
}

export function bitcoinAddressLabel(type: string | null | undefined): string {
  if (type === 'p2pkh') return 'Legacy'
  if (type === 'p2sh-p2wpkh') return 'Nested SegWit'
  if (type === 'p2wpkh') return 'Native SegWit'
  if (type === 'p2tr') return 'Taproot'
  return type ?? ''
}
