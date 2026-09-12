/**
 * TRON 转账：直连 TronGrid 创建未签名交易，本地 secp256k1 签 txID 后广播。
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { NetworkScope } from '@shared/types'
import { asNumber, asRecord, asString } from '../backend/list'
import { DEFAULT_ENERGY_FEE_SUN, parseEnergyPriceSun } from '../energy/codec'
import { isTronAddress, tronAddressToHex } from '../derive/tron'
import { networkByType, tronApiCandidates, tryRpcUrls } from '../rpc/nodes'
import { setPreferredRpc } from '../rpc/preference'
import { trongridApiKey } from '../rpc/env'
import { providerGet, providerPost } from '../rpc/fetch'
import { joinRpcPath } from '../rpc/url'

export interface TronUnsignedTx {
  txID: string
  [key: string]: unknown
}

function trongridHeaders(): Record<string, string> | undefined {
  const key = trongridApiKey()
  return key ? { 'TRON-PRO-API-KEY': key } : undefined
}

async function trongrid<T>(path: string, body: unknown, scope: NetworkScope): Promise<T> {
  const { url, result } = await tryRpcUrls(tronApiCandidates(scope), (base) =>
    providerPost<T>(joinRpcPath(base, path), body, { headers: trongridHeaders() }),
  )
  const network = networkByType('tron', scope)
  if (network) setPreferredRpc(network.id, url)
  return result
}

async function trongridGet<T>(path: string, scope: NetworkScope): Promise<T> {
  const { url, result } = await tryRpcUrls(tronApiCandidates(scope), (base) =>
    providerGet<T>(joinRpcPath(base, path), trongridHeaders()),
  )
  const network = networkByType('tron', scope)
  if (network) setPreferredRpc(network.id, url)
  return result
}

export function encodeTrc20TransferParameter(to: string, amount: bigint): string {
  const addressHex = tronAddressToHex(to).replace(/^41/i, '')
  return `${addressHex.padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`
}

function encodeTrc20BalanceOf(address: string): string {
  const addressHex = tronAddressToHex(address).replace(/^41/i, '')
  return addressHex.padStart(64, '0')
}

export async function createTronNativeTx(input: {
  from: string
  to: string
  amountSun: bigint
  networkScope: NetworkScope
}): Promise<TronUnsignedTx> {
  if (!isTronAddress(input.to)) throw new Error('收款地址不是有效的 TRON 地址')
  const payload = await trongrid<Record<string, unknown>>(
    'wallet/createtransaction',
    {
      owner_address: input.from,
      to_address: input.to,
      amount: Number(input.amountSun),
      visible: true,
    },
    input.networkScope,
  )
  const txID = asString(payload.txID ?? payload.txid)
  if (!txID) throw new Error('TronGrid 未返回未签名交易')
  return { ...payload, txID }
}

export async function createTrc20Tx(input: {
  from: string
  to: string
  contract: string
  amount: bigint
  feeLimitSun: bigint
  networkScope: NetworkScope
}): Promise<TronUnsignedTx> {
  if (!isTronAddress(input.to)) throw new Error('收款地址不是有效的 TRON 地址')
  const payload = await trongrid<Record<string, unknown>>(
    'wallet/triggersmartcontract',
    {
      owner_address: input.from,
      contract_address: input.contract,
      function_selector: 'transfer(address,uint256)',
      parameter: encodeTrc20TransferParameter(input.to, input.amount),
      fee_limit: Number(input.feeLimitSun),
      visible: true,
    },
    input.networkScope,
  )
  const nested = asRecord(payload.transaction) ?? payload
  const txID = asString(nested.txID ?? nested.txid)
  if (!txID) {
    const message = asString(asRecord(payload.result)?.message, '创建 TRC20 交易失败')
    throw new Error(message)
  }
  return { ...nested, txID }
}

export async function callTronContract(input: {
  from: string
  contract: string
  selector: string
  parameter: string
  networkScope: NetworkScope
}): Promise<string> {
  const payload = await trongrid<Record<string, unknown>>(
    'wallet/triggerconstantcontract',
    {
      owner_address: input.from,
      contract_address: input.contract,
      function_selector: input.selector,
      parameter: input.parameter,
      visible: true,
    },
    input.networkScope,
  )
  const result = asRecord(payload.result)
  if (result && result.result === false) {
    throw new Error(asString(result.message) || asString(payload.message) || '合约只读调用失败')
  }
  const results = payload.constant_result
  const hex = Array.isArray(results) ? String(results[0] ?? '') : ''
  return hex
}

export async function createTronContractTx(input: {
  from: string
  contract: string
  selector: string
  parameter: string
  feeLimitSun: bigint
  callValueSun?: bigint
  networkScope: NetworkScope
}): Promise<TronUnsignedTx> {
  const payload = await trongrid<Record<string, unknown>>(
    'wallet/triggersmartcontract',
    {
      owner_address: input.from,
      contract_address: input.contract,
      function_selector: input.selector,
      parameter: input.parameter,
      fee_limit: Number(input.feeLimitSun),
      call_value: Number(input.callValueSun ?? 0n),
      visible: true,
    },
    input.networkScope,
  )
  const nested = asRecord(payload.transaction) ?? payload
  const txID = asString(nested.txID ?? nested.txid)
  if (!txID) {
    const message = asString(asRecord(payload.result)?.message, '创建合约交易失败')
    throw new Error(message)
  }
  return { ...nested, txID }
}

export function signTronTx(unsigned: TronUnsignedTx, privateKey: Uint8Array): TronUnsignedTx {
  const txidHex = unsigned.txID.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(txidHex)) throw new Error('TRON txID 不合法')
  const signature = secp256k1.sign(hexToBytes(txidHex), privateKey, { prehash: false })
  const v = (signature.recovery + 27).toString(16).padStart(2, '0')
  const signatureHex = `${bytesToHex(signature.toBytes('compact'))}${v}`
  const existing = Array.isArray(unsigned.signature) ? unsigned.signature : []
  return { ...unsigned, signature: [...existing, signatureHex] }
}

export async function broadcastTronTx(
  signed: TronUnsignedTx,
  networkScope: NetworkScope,
): Promise<string> {
  const payload = await trongrid<Record<string, unknown>>('wallet/broadcasttransaction', signed, networkScope)
  const ok = payload.result !== false && asRecord(payload.result)?.result !== false
  const txid = asString(payload.txid ?? payload.txID ?? signed.txID)
  if (!ok) {
    throw new Error(asString(payload.message, 'TRON 广播失败'))
  }
  if (!txid) throw new Error('TRON 广播未返回 txid')
  return txid
}

export async function getTronAccountResource(
  address: string,
  networkScope: NetworkScope,
): Promise<Record<string, unknown>> {
  return trongrid<Record<string, unknown>>(
    'wallet/getaccountresource',
    { address, visible: true },
    networkScope,
  )
}

export async function getTronAccount(address: string, networkScope: NetworkScope): Promise<{
  balanceSun: bigint
  active: boolean
}> {
  try {
    const payload = await trongrid<Record<string, unknown>>(
      'wallet/getaccount',
      { address, visible: true },
      networkScope,
    )
    const balance = typeof payload.balance === 'number' ? BigInt(payload.balance) : 0n
    return { balanceSun: balance, active: Boolean(payload.address) }
  } catch {
    return { balanceSun: 0n, active: false }
  }
}

export async function getTrc20Balance(
  contract: string,
  address: string,
  networkScope: NetworkScope,
): Promise<bigint> {
  const payload = await trongrid<Record<string, unknown>>(
    'wallet/triggerconstantcontract',
    {
      owner_address: address,
      contract_address: contract,
      function_selector: 'balanceOf(address)',
      parameter: encodeTrc20BalanceOf(address),
      visible: true,
    },
    networkScope,
  )
  const results = payload.constant_result
  const hex = Array.isArray(results) ? String(results[0] ?? '') : ''
  if (!hex) return 0n
  return BigInt(`0x${hex.replace(/^0x/, '') || '0'}`)
}

export function estimateTronNativeFeeSun(recipientActive: boolean): bigint {
  return recipientActive ? 270_000n : 1_100_000n + 270_000n
}

/** 当前能量单价，单位 sun / energy。 */
export async function getTronEnergyFeeSun(networkScope: NetworkScope): Promise<bigint> {
  try {
    const payload = await trongridGet<Record<string, unknown>>('wallet/getenergyprices', networkScope)
    const fee = parseEnergyPriceSun(payload.prices)
    if (fee > 0n) return fee
  } catch {
    /* 部分节点只接受 POST */
  }
  try {
    const payload = await trongrid<Record<string, unknown>>('wallet/getenergyprices', {}, networkScope)
    const fee = parseEnergyPriceSun(payload.prices)
    if (fee > 0n) return fee
  } catch {
    /* 再读链参数 */
  }
  try {
    const payload = await trongrid<Record<string, unknown>>('wallet/getchainparameters', {}, networkScope)
    const params = payload.chainParameter
    if (Array.isArray(params)) {
      for (const item of params) {
        const record = asRecord(item)
        if (record && asString(record.key) === 'getEnergyFee') {
          const value = asNumber(record.value, 0)
          if (value > 0) return BigInt(Math.round(value))
        }
      }
    }
  } catch {
    /* 用默认单价 */
  }
  return DEFAULT_ENERGY_FEE_SUN
}

/** 只读模拟 TRC-20 transfer，估算本次消耗的能量。失败返回 0。 */
export async function estimateTrc20Energy(input: {
  from: string
  to: string
  contract: string
  amount: bigint
  networkScope: NetworkScope
}): Promise<number> {
  try {
    const payload = await trongrid<Record<string, unknown>>(
      'wallet/triggerconstantcontract',
      {
        owner_address: input.from,
        contract_address: input.contract,
        function_selector: 'transfer(address,uint256)',
        parameter: encodeTrc20TransferParameter(input.to, input.amount),
        visible: true,
      },
      input.networkScope,
    )
    const used = asNumber(payload.energy_used, 0) + asNumber(payload.energy_penalty, 0)
    if (used > 0) return used
    return asNumber(payload.energy_required, 0)
  } catch {
    return 0
  }
}

export function explorerUrlForTron(txid: string, networkScope: NetworkScope, browser: string | null): string | null {
  if (browser) return `${browser.replace(/\/+$/, '')}/#/transaction/${txid}`
  return networkScope === 'mainnet'
    ? `https://tronscan.org/#/transaction/${txid}`
    : `https://nile.tronscan.org/#/transaction/${txid}`
}

export async function fetchTronTxInfo(txid: string, networkScope: NetworkScope): Promise<unknown> {
  return trongrid<unknown>('wallet/gettransactioninfobyid', { value: txid }, networkScope)
}

export async function fetchTronAccountTransactions(address: string, networkScope: NetworkScope): Promise<unknown> {
  return trongridGet<unknown>(
    `v1/accounts/${encodeURIComponent(address)}/transactions?limit=50&only_confirmed=true`,
    networkScope,
  )
}

export async function fetchTronAccountTrc20(address: string, networkScope: NetworkScope): Promise<unknown> {
  return trongridGet<unknown>(
    `v1/accounts/${encodeURIComponent(address)}/transactions/trc20?limit=50&only_confirmed=true`,
    networkScope,
  )
}

export async function fetchTronAccountInternal(address: string, networkScope: NetworkScope): Promise<unknown> {
  return trongridGet<unknown>(
    `v1/accounts/${encodeURIComponent(address)}/internal-transactions?limit=50&only_confirmed=true`,
    networkScope,
  )
}
