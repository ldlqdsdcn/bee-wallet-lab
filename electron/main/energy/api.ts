/**
 * 能量租赁目录站接口。路径与 bee-wallet-server /api/tronOrder 对齐。
 */
import { BackendError } from '../backend/http'
import { get, post } from '../backend/client'
import { parseEstimatePayload, parseOrderNo, parseOrderStatus } from './codec'

/** 登记在付款之后，目录偶发慢或中断；超时后用同一 payTxHash 重试（服务端按哈希去重）。 */
const CREATE_ORDER_TIMEOUT_MS = 45_000
const CREATE_ORDER_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function canRetryRegister(err: unknown): boolean {
  return err instanceof BackendError && (err.code === 'TIMEOUT' || err.code === 'NETWORK')
}

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
  const body = {
    queryNo: input.queryNo,
    walletAddress: input.walletAddress,
    payTxHash: input.payTxHash,
    targetAddress: input.targetAddress,
  }
  let lastError: unknown
  for (let attempt = 1; attempt <= CREATE_ORDER_ATTEMPTS; attempt++) {
    try {
      const data = await post<unknown>('/api/tronOrder/createOrder', body, {
        timeoutMs: CREATE_ORDER_TIMEOUT_MS,
      })
      return parseOrderNo(data)
    } catch (err) {
      lastError = err
      if (!canRetryRegister(err) || attempt === CREATE_ORDER_ATTEMPTS) throw err
      await sleep(1500 * attempt)
    }
  }
  throw lastError
}

export async function fetchEnergyOrderStatus(orderNo: string) {
  const data = await get<unknown>(`/api/tronOrder/orderStatus/${encodeURIComponent(orderNo)}`)
  return parseOrderStatus(data)
}
