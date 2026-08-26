/**
 * 金额换算：十进制字符串 <-> 最小单位 bigint。
 * 不用浮点，避免 0.1 + 0.2 这类误差进到链上。
 */

const DIGITS = /^(\d+)(?:\.(\d+))?$/

export function parseDecimalToMinor(amount: string, decimals: number): bigint {
  const trimmed = amount.trim()
  if (!trimmed) throw new Error('金额不能为空')
  const match = DIGITS.exec(trimmed)
  if (!match) throw new Error(`金额格式不合法：${amount}`)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`decimals 不合法：${decimals}`)
  }
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').replace(/0+$/, '')
  if (fraction.length > decimals) {
    throw new Error(`金额小数位超过代币精度 ${decimals}`)
  }
  const padded = fraction.padEnd(decimals, '0')
  const combined = `${whole}${padded}`.replace(/^0+(?=\d)/, '')
  return BigInt(combined || '0')
}

export function formatMinor(amount: bigint, decimals: number): string {
  const negative = amount < 0n
  const abs = negative ? -amount : amount
  if (decimals === 0) return `${negative ? '-' : ''}${abs.toString()}`
  const raw = abs.toString().padStart(decimals + 1, '0')
  const whole = raw.slice(0, -decimals)
  const fraction = raw.slice(-decimals).replace(/0+$/, '')
  const body = fraction ? `${whole}.${fraction}` : whole
  return `${negative ? '-' : ''}${body}`
}

export function isPositiveAmount(amount: string): boolean {
  try {
    return parseDecimalToMinor(amount, 18) > 0n
  } catch {
    return false
  }
}
