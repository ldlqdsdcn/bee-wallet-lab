/**
 * 批量转账金额：固定额度，或在 [min, max] 闭区间用密码学随机取一笔。
 */
import { randomBytes } from 'node:crypto'

export function randomBigIntInclusive(min: bigint, max: bigint): bigint {
  if (max < min) throw new Error('金额上限不能小于下限')
  const span = max - min + 1n
  if (span === 1n) return min
  const byteLength = Math.max(1, Math.ceil(span.toString(16).length / 2))
  const limit = 1n << BigInt(byteLength * 8)
  for (;;) {
    const buf = randomBytes(byteLength)
    let value = 0n
    for (const byte of buf) value = (value << 8n) | BigInt(byte)
    if (value < limit - (limit % span)) return min + (value % span)
  }
}

/** 逐笔签名 + 广播 + 间隔的经验值，用来估 2 万笔要跑多久 */
export const MS_PER_AIRDROP = 450

export function estimateAirdropDurationMs(count: number): number {
  return Math.max(0, Math.floor(count)) * MS_PER_AIRDROP
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `约 ${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `约 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `约 ${hours} 小时 ${rem} 分钟` : `约 ${hours} 小时`
}
