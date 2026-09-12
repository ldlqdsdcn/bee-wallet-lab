/**
 * 波场能量租赁：询价 / 下单响应解包与参数校验。
 * 不发网络请求，方便单测。
 */
import type { EnergyDuration, EnergyResources } from '@shared/types'
import { asNumber, asRecord, asString } from '../backend/list'
import { isTronAddress } from '../derive/tron'
import { formatMinor } from '../util/amount'

export const ENERGY_DURATIONS = ['1h', '1d'] as const
export const DEFAULT_ENERGY_QUANTITY = 65_000
/** 目录 gasLimit 超过此值视为 EVM gas，不能当波场能量用（USDT 常写成 1000000）。 */
export const TRON_ENERGY_CATALOG_MAX = 300_000
export const ENERGY_QUANTITY_MIN = 32_000
export const ENERGY_QUANTITY_MAX = 2_000_000
export const ENERGY_CATALOG_HINT = 'https://beeqd.com'
export const DEFAULT_ENERGY_FEE_SUN = 210n
export const TRC20_FEE_LIMIT_SUN = 40_000_000n

export function sunToTrx(sun: bigint | number | string): string {
  const raw = typeof sun === 'bigint' ? sun : BigInt(String(sun).trim())
  if (raw < 0n) throw new Error('价格不能为负数')
  return formatMinor(raw, 6)
}

export function requiredEnergy(estimated: number, tokenGasLimit: number | null): number {
  const used = Number.isFinite(estimated) && estimated > 0 ? Math.ceil(estimated) : 0
  if (used > 0) return used
  if (tokenGasLimit && tokenGasLimit > 0 && tokenGasLimit <= TRON_ENERGY_CATALOG_MAX) {
    return tokenGasLimit
  }
  return DEFAULT_ENERGY_QUANTITY
}

/** 能量缺口对应的租赁数量；够用返回 0，不足时至少租 ENERGY_QUANTITY_MIN。 */
/** getenergyprices 形如 `0:210,1680000000000:420`，取当前（最后一档）单价，单位 sun/energy。 */
export function parseEnergyPriceSun(value: unknown): bigint {
  const text = String(value ?? '').trim()
  if (/^\d+$/.test(text)) return BigInt(text)
  const last = text.split(',').map((item) => item.trim()).filter(Boolean).pop()
  const fee = last?.split(':')[1]?.trim()
  if (fee && /^\d+$/.test(fee) && BigInt(fee) > 0n) return BigInt(fee)
  return 0n
}

/** 能量缺口按链上单价燃烧的 TRX（sun）。不超过 feeLimit。 */
export function burnSunForEnergy(required: number, left: number, feePerEnergySun: bigint): bigint {
  const missing = Math.max(0, Math.ceil(required) - Math.max(0, Math.floor(left)))
  if (missing <= 0 || feePerEnergySun <= 0n) return 0n
  const burned = BigInt(missing) * feePerEnergySun
  return burned > TRC20_FEE_LIMIT_SUN ? TRC20_FEE_LIMIT_SUN : burned
}

export function compareEnergyFees(rentSun: bigint, burnSun: bigint): 'rent' | 'burn' | 'same' {
  if (rentSun < burnSun) return 'rent'
  if (burnSun < rentSun) return 'burn'
  return 'same'
}

export function rentQuantity(required: number, left: number): number {
  const need = Math.max(0, Math.ceil(required) - Math.max(0, Math.floor(left)))
  if (need <= 0) return 0
  return Math.min(ENERGY_QUANTITY_MAX, Math.max(ENERGY_QUANTITY_MIN, need))
}

export function parseEnergyQuantity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isInteger(n) || n < ENERGY_QUANTITY_MIN || n > ENERGY_QUANTITY_MAX) {
    throw new Error(`能量数量需为 ${ENERGY_QUANTITY_MIN}–${ENERGY_QUANTITY_MAX} 的整数`)
  }
  return n
}

export function parseEnergyDuration(value: unknown): EnergyDuration {
  const duration = String(value ?? '').trim()
  if (duration === '1h' || duration === '1d') return duration
  throw new Error('租赁时长仅支持 1h 或 1d')
}

export function parsePriceSun(value: unknown): bigint {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return BigInt(Math.round(value))
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = BigInt(value.trim())
    if (parsed > 0n) return parsed
  }
  throw new Error('询价未返回有效价格')
}

export function parseEstimatePayload(data: unknown): {
  priceSun: bigint
  queryNo: string
  targetAddress: string
  quantity: number
} {
  const record = asRecord(data)
  if (!record) throw new Error('询价响应无效')
  const queryNo = asString(record.queryNo).trim()
  const targetAddress = asString(record.targetAddress).trim()
  if (!queryNo) throw new Error('询价未返回 queryNo')
  if (!isTronAddress(targetAddress)) throw new Error('询价收款地址不是有效的 TRON 地址')
  return {
    priceSun: parsePriceSun(record.price),
    queryNo,
    targetAddress,
    quantity: parseEnergyQuantity(record.quantity ?? record.gasLimit),
  }
}

export function parseOrderNo(data: unknown): string {
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (typeof data === 'number' && Number.isFinite(data)) return String(Math.trunc(data))
  const record = asRecord(data)
  const orderNo = asString(record?.orderNo ?? record?.order_no).trim()
  if (orderNo) return orderNo
  throw new Error('下单未返回订单号')
}

export function parsePayTxHash(value: unknown): string {
  const hash = String(value ?? '')
    .trim()
    .replace(/^0x/i, '')
    .toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('付款交易哈希不合法')
  return hash
}

export function parseOrderStatus(data: unknown): { status: number; description: string } {
  const record = asRecord(data)
  if (!record) throw new Error('订单状态响应无效')
  const status = asNumber(record.status, Number.NaN)
  if (!Number.isInteger(status)) throw new Error('订单状态无效')
  const fallback =
    status === 1 ? '处理中' : status === 2 ? '能量值充值成功' : status === 3 ? '充值失败' : '未知状态'
  return { status, description: asString(record.description, fallback) }
}

export function parseResourcePayload(
  data: unknown,
  address: string,
  balanceSun: bigint,
): EnergyResources {
  const record = asRecord(data) ?? {}
  const energyLimit = asNumber(record.EnergyLimit, 0)
  const energyUsed = asNumber(record.EnergyUsed, 0)
  const freeNetLimit = asNumber(record.freeNetLimit, 0)
  const freeNetUsed = asNumber(record.freeNetUsed, 0)
  const netLimit = asNumber(record.NetLimit, 0)
  const netUsed = asNumber(record.NetUsed, 0)
  return {
    address,
    balanceTrx: sunToTrx(balanceSun),
    energyLimit,
    energyUsed,
    energyLeft: Math.max(0, energyLimit - energyUsed),
    bandwidthLeft: Math.max(0, freeNetLimit - freeNetUsed) + Math.max(0, netLimit - netUsed),
  }
}
