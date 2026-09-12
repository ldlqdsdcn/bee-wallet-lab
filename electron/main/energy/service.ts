/**
 * 波场能量租赁：询价、本机签 TRX 付款、登记订单、查状态。
 * 私钥不出主进程；目录站只收到公开地址和付款哈希。
 */
import type {
  EnergyConfirmInput,
  EnergyEstimateInput,
  EnergyOrderStatus,
  EnergyQuote,
  EnergyRentInput,
  EnergyRentResult,
  EnergyResources,
  NetworkRecord,
} from '@shared/types'
import { getBaseUrl } from '../backend/config'
import { getAccountRow } from '../db/repos/accountRepo'
import { getNetwork, listTokens } from '../db/repos/catalogRepo'
import {
  broadcastTronTx,
  createTronNativeTx,
  getTronAccount,
  getTronAccountResource,
  signTronTx,
} from '../chain/tron'
import { invalidArg, notFound } from '../ipc/registry'
import { explorerUrlForNetwork, persistBroadcastedTx } from '../txLab/service'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import { createEnergyOrder, estimateEnergyOrder, fetchEnergyOrderStatus } from './api'
import {
  ENERGY_CATALOG_HINT,
  parseEnergyDuration,
  parseEnergyQuantity,
  parsePayTxHash,
  parsePriceSun,
  parseResourcePayload,
  sunToTrx,
} from './codec'

function requireCatalogUrl(): void {
  if (!getBaseUrl()) {
    throw invalidArg(`请先在设置里填写目录站地址，能量租赁使用 ${ENERGY_CATALOG_HINT}`)
  }
}

function requireTronNetwork(networkPk: string): NetworkRecord {
  const network = getNetwork(networkPk)
  if (!network) throw notFound('网络不存在，请先同步目录')
  if (network.walletType !== 'tron') throw invalidArg('能量查询只支持波场网络')
  return network
}

function requireTronMainnet(networkPk: string): NetworkRecord {
  const network = requireTronNetwork(networkPk)
  if (network.networkScope !== 'mainnet') throw invalidArg('能量租赁只支持波场主网，测试网无法核款')
  return network
}

function requireTronAccount(accountId: string) {
  const record = getAccount(accountId)
  if (record.walletType !== 'tron') throw invalidArg('请选择波场账户')
  const row = getAccountRow(accountId)
  if (!row) throw notFound('付款账户不存在')
  return { record, row }
}

function nativeTokenPk(networkPk: string): string | null {
  const native = listTokens(networkPk).find((token) => !token.isToken)
  return native?.id ?? null
}

export async function loadEnergyResources(accountId: string, networkPk: string): Promise<EnergyResources> {
  const network = requireTronNetwork(networkPk)
  const { record } = requireTronAccount(accountId)
  const [account, resource] = await Promise.all([
    getTronAccount(record.address, network.networkScope),
    getTronAccountResource(record.address, network.networkScope).catch(() => ({})),
  ])
  return parseResourcePayload(resource, record.address, account.balanceSun)
}

export async function estimateEnergyRent(input: EnergyEstimateInput): Promise<EnergyQuote> {
  requireCatalogUrl()
  const network = requireTronMainnet(input.networkPk)
  const { record } = requireTronAccount(input.accountId)
  const quantity = parseEnergyQuantity(input.quantity)
  const duration = parseEnergyDuration(input.duration)
  const [quote, resources] = await Promise.all([
    estimateEnergyOrder(quantity, duration),
    loadEnergyResources(record.id, network.id),
  ])
  if (quote.quantity !== quantity) {
    throw invalidArg('询价返回的能量数量与请求不一致，请重新询价')
  }
  return {
    queryNo: quote.queryNo,
    quantity: quote.quantity,
    duration,
    priceSun: quote.priceSun.toString(),
    priceTrx: sunToTrx(quote.priceSun),
    targetAddress: quote.targetAddress,
    payAccount: record.address,
    resources,
  }
}

async function payEnergyQuote(input: EnergyRentInput): Promise<{
  network: NetworkRecord
  from: string
  payTxHash: string
  raw: string
}> {
  const network = requireTronMainnet(input.networkPk)
  const { record, row } = requireTronAccount(input.accountId)
  const quantity = parseEnergyQuantity(input.quantity)
  const duration = parseEnergyDuration(input.duration)
  const priceSun = parsePriceSun(input.priceSun)
  const queryNo = String(input.queryNo ?? '').trim()
  const targetAddress = String(input.targetAddress ?? '').trim()
  if (!queryNo) throw invalidArg('询价已过期，请重新询价')
  if (duration !== input.duration) throw invalidArg('租赁时长无效')
  if (quantity !== input.quantity) throw invalidArg('能量数量无效')

  const unsigned = await createTronNativeTx({
    from: record.address,
    to: targetAddress,
    amountSun: priceSun,
    networkScope: network.networkScope,
  })
  const signed = withAccountPrivateKey(row, (privateKey) => signTronTx(unsigned, privateKey))
  const payTxHash = await broadcastTronTx(signed, network.networkScope)
  persistBroadcastedTx({
    network,
    accountId: record.id,
    from: record.address,
    to: targetAddress,
    tokenPk: nativeTokenPk(network.id),
    symbol: 'TRX',
    amount: sunToTrx(priceSun),
    fee: null,
    txid: payTxHash,
    raw: JSON.stringify(signed),
  })
  return { network, from: record.address, payTxHash, raw: JSON.stringify(signed) }
}

async function registerPaidOrder(input: {
  queryNo: string
  walletAddress: string
  payTxHash: string
  targetAddress: string
  explorerUrl: string | null
}): Promise<EnergyRentResult> {
  const payTxHash = parsePayTxHash(input.payTxHash)
  try {
    const orderNo = await createEnergyOrder({
      queryNo: input.queryNo,
      walletAddress: input.walletAddress,
      payTxHash,
      targetAddress: input.targetAddress,
    })
    const status = await fetchEnergyOrderStatus(orderNo).catch(() => ({
      status: 1,
      description: '处理中',
    }))
    return {
      orderNo,
      payTxHash,
      explorerUrl: input.explorerUrl,
      status: status.status,
      description: status.description,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      orderNo: null,
      payTxHash,
      explorerUrl: input.explorerUrl,
      status: 0,
      description: `付款已广播，登记订单失败：${message}`,
    }
  }
}

export async function submitEnergyRent(input: EnergyRentInput): Promise<EnergyRentResult> {
  requireCatalogUrl()
  const paid = await payEnergyQuote(input)
  return registerPaidOrder({
    queryNo: input.queryNo,
    walletAddress: paid.from,
    payTxHash: paid.payTxHash,
    targetAddress: input.targetAddress,
    explorerUrl: explorerUrlForNetwork(paid.network, paid.payTxHash),
  })
}

export async function confirmEnergyRent(input: EnergyConfirmInput): Promise<EnergyRentResult> {
  requireCatalogUrl()
  const network = requireTronMainnet(input.networkPk)
  const { record } = requireTronAccount(input.accountId)
  return registerPaidOrder({
    queryNo: input.queryNo,
    walletAddress: record.address,
    payTxHash: input.payTxHash,
    targetAddress: input.targetAddress,
    explorerUrl: explorerUrlForNetwork(network, parsePayTxHash(input.payTxHash)),
  })
}

export async function energyOrderStatus(orderNo: string): Promise<EnergyOrderStatus> {
  requireCatalogUrl()
  const value = String(orderNo ?? '').trim()
  if (!value) throw invalidArg('订单号不能为空')
  const status = await fetchEnergyOrderStatus(value)
  return { orderNo: value, ...status }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForEnergyOrder(orderNo: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await fetchEnergyOrderStatus(orderNo)
    if (status.status === 2) return
    if (status.status === 3) throw invalidArg('能量充值失败，请改用燃烧 TRX 或稍后重试')
    await sleep(3_000)
  }
  throw invalidArg('等待能量到账超时。付款可能已成功，请稍后直接重试转账')
}

/** 询价、付款、等到能量到账。供 TRC-20 转账在广播代币前调用。 */
export async function rentEnergyAndWait(input: {
  accountId: string
  networkPk: string
  quantity: number
  duration?: EnergyEstimateInput['duration']
}): Promise<EnergyRentResult> {
  const quote = await estimateEnergyRent({
    accountId: input.accountId,
    networkPk: input.networkPk,
    quantity: input.quantity,
    duration: input.duration ?? '1h',
  })
  const result = await submitEnergyRent({
    accountId: input.accountId,
    networkPk: input.networkPk,
    queryNo: quote.queryNo,
    quantity: quote.quantity,
    duration: quote.duration,
    priceSun: quote.priceSun,
    targetAddress: quote.targetAddress,
  })
  if (!result.orderNo) throw invalidArg(result.description)
  await waitForEnergyOrder(result.orderNo)
  return result
}
