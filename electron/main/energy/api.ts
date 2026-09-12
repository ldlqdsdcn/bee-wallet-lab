/**
 * 能量租赁目录站接口。路径与 bee-wallet-server /api/tronOrder 对齐。
 */
import { get, post } from '../backend/client'
import { parseEstimatePayload, parseOrderNo, parseOrderStatus } from './codec'

export async function estimateEnergyOrder(quantity: number, duration: string) {
  const data = await get<unknown>('/api/tronOrder/estimate', {
    gasLimit: quantity,
    timeLimit: duration,
  })
  return parseEstimatePayload(data)
}

export async function createEnergyOrder(input: {
  queryNo: string
  walletAddress: string
  payTxHash: string
  targetAddress: string
}): Promise<string> {
  const data = await post<unknown>('/api/tronOrder/createOrder', {
    queryNo: input.queryNo,
    walletAddress: input.walletAddress,
    payTxHash: input.payTxHash,
    targetAddress: input.targetAddress,
  })
  return parseOrderNo(data)
}

export async function fetchEnergyOrderStatus(orderNo: string) {
  const data = await get<unknown>(`/api/tronOrder/orderStatus/${encodeURIComponent(orderNo)}`)
  return parseOrderStatus(data)
}
