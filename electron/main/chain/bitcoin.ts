/**
 * Bitcoin 链上适配：UTXO、费率、签名、广播。直连 Esplora（Blockstream / mempool）。
 */
import * as btc from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils'
import type { BitcoinAddressType, NetworkScope } from '@shared/types'
import { extractList } from '../backend/list'
import { isBitcoinAddress } from '../derive/bitcoin'
import { resolveBitcoinApiBase } from '../rpc/endpoints'
import { providerGet, providerPost } from '../rpc/fetch'

type BtcNetwork = typeof btc.NETWORK

export interface BitcoinUtxo {
  txid: string
  vout: number
  valueSats: number
  rawTxHex?: string
}

export interface BitcoinFeeRates {
  low: number
  medium: number
  high: number
}

export interface BitcoinBuildResult {
  hex: string
  feeSats: bigint
  vsize: number
  changeSats: bigint
}

const DUST = 546n
const SAFETY = 1.2

function networkOf(scope: NetworkScope): BtcNetwork {
  return scope === 'mainnet' ? btc.NETWORK : btc.TEST_NETWORK
}

function esplora(scope: NetworkScope, path: string): string {
  return `${resolveBitcoinApiBase(scope)}/${path.replace(/^\/+/, '')}`
}

function toXOnly(publicKey: Uint8Array): Uint8Array {
  return publicKey.length === 32 ? publicKey : publicKey.subarray(1, 33)
}

export function bitcoinPayment(
  publicKey: Uint8Array,
  addressType: BitcoinAddressType,
  networkScope: NetworkScope,
) {
  const network = networkOf(networkScope)
  switch (addressType) {
    case 'p2pkh':
      return btc.p2pkh(publicKey, network)
    case 'p2sh-p2wpkh':
      return btc.p2sh(btc.p2wpkh(publicKey, network), network)
    case 'p2wpkh':
      return btc.p2wpkh(publicKey, network)
    case 'p2tr':
      return btc.p2tr(toXOnly(publicKey), undefined, network)
  }
}

export function inputVBytes(addressType: BitcoinAddressType): number {
  switch (addressType) {
    case 'p2pkh':
      return 148
    case 'p2sh-p2wpkh':
      return 91
    case 'p2wpkh':
      return 68
    case 'p2tr':
      return 58
  }
}

export function outputVBytes(addressType: BitcoinAddressType): number {
  switch (addressType) {
    case 'p2pkh':
      return 34
    case 'p2sh-p2wpkh':
      return 32
    case 'p2wpkh':
      return 31
    case 'p2tr':
      return 43
  }
}

export function estimateVsize(
  addressType: BitcoinAddressType,
  inputCount: number,
  outputCount: number,
): number {
  return Math.ceil(10.5 + inputCount * inputVBytes(addressType) + outputCount * outputVBytes(addressType))
}

export async function fetchAddressStats(address: string, networkScope: NetworkScope): Promise<{
  confirmed: bigint
  unconfirmed: bigint
}> {
  const data = await providerGet<Record<string, unknown>>(esplora(networkScope, `address/${address}`))
  const chain = (data.chain_stats ?? {}) as Record<string, number>
  const mempool = (data.mempool_stats ?? {}) as Record<string, number>
  const confirmed = BigInt((chain.funded_txo_sum ?? 0) - (chain.spent_txo_sum ?? 0))
  const unconfirmed = BigInt((mempool.funded_txo_sum ?? 0) - (mempool.spent_txo_sum ?? 0))
  return { confirmed, unconfirmed }
}

export async function fetchUtxos(address: string, networkScope: NetworkScope): Promise<BitcoinUtxo[]> {
  const payload = await providerGet<unknown>(esplora(networkScope, `address/${address}/utxo`))
  return extractList<Record<string, unknown>>(payload).map((item) => ({
    txid: String(item.txid ?? ''),
    vout: Number(item.vout ?? 0),
    valueSats: Number(item.valueSats ?? item.value ?? 0),
    rawTxHex: typeof item.rawTxHex === 'string' ? item.rawTxHex : undefined,
  }))
}

export async function fetchFeeRates(networkScope: NetworkScope): Promise<BitcoinFeeRates> {
  const data = await providerGet<Record<string, number>>(esplora(networkScope, 'fee-estimates'))
  const pick = (...keys: Array<string | number>) => {
    for (const key of keys) {
      const value = data[String(key)]
      if (typeof value === 'number' && value > 0) return value
    }
    return 1
  }
  return {
    high: pick('fastestFee', 'high', 1, 2),
    medium: pick('halfHourFee', 'medium', 3, 6),
    low: pick('hourFee', 'low', 6, 12),
  }
}

async function fetchTxHex(txid: string, networkScope: NetworkScope): Promise<string> {
  const data = await providerGet<unknown>(esplora(networkScope, `tx/${txid}/hex`))
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (data && typeof data === 'object' && 'hex' in data) return String((data as { hex: string }).hex)
  throw new Error(`无法获取交易 ${txid} 的原始 hex`)
}

function selectUtxos(
  utxos: BitcoinUtxo[],
  amountSats: bigint,
  feeRate: number,
  addressType: BitcoinAddressType,
  sendMax: boolean,
): { selected: BitcoinUtxo[]; feeSats: bigint; changeSats: bigint } {
  const sorted = [...utxos].sort((a, b) => b.valueSats - a.valueSats)
  if (sorted.length === 0) throw new Error('没有可用 UTXO')

  if (sendMax) {
    const total = sorted.reduce((sum, item) => sum + BigInt(item.valueSats), 0n)
    const vsize = estimateVsize(addressType, sorted.length, 1)
    const feeSats = BigInt(Math.ceil(vsize * feeRate * SAFETY))
    if (total <= feeSats + DUST) throw new Error('余额不足以支付矿工费')
    return { selected: sorted, feeSats, changeSats: 0n }
  }

  const selected: BitcoinUtxo[] = []
  let total = 0n
  for (const utxo of sorted) {
    selected.push(utxo)
    total += BigInt(utxo.valueSats)
    const vsizeWithChange = estimateVsize(addressType, selected.length, 2)
    const feeWithChange = BigInt(Math.ceil(vsizeWithChange * feeRate * SAFETY))
    if (total >= amountSats + feeWithChange) {
      const change = total - amountSats - feeWithChange
      if (change >= DUST) return { selected, feeSats: feeWithChange, changeSats: change }
      const vsizeNoChange = estimateVsize(addressType, selected.length, 1)
      const feeNoChange = BigInt(Math.ceil(vsizeNoChange * feeRate * SAFETY))
      if (total >= amountSats + feeNoChange) {
        return { selected, feeSats: total - amountSats, changeSats: 0n }
      }
    }
  }
  throw new Error('余额不足以完成本次转账（含矿工费）')
}

export async function buildAndSignBitcoinTx(input: {
  networkScope: NetworkScope
  addressType: BitcoinAddressType
  fromAddress: string
  toAddress: string
  publicKeyHex: string
  privateKey: Uint8Array
  amountSats: bigint
  feeRate: number
  sendMax?: boolean
}): Promise<BitcoinBuildResult> {
  if (!isBitcoinAddress(input.toAddress, input.networkScope)) {
    throw new Error('收款地址不是有效的 Bitcoin 地址')
  }
  const utxos = await fetchUtxos(input.fromAddress, input.networkScope)
  const selection = selectUtxos(
    utxos,
    input.amountSats,
    input.feeRate,
    input.addressType,
    Boolean(input.sendMax),
  )
  const sendAmount = input.sendMax
    ? selection.selected.reduce((sum, item) => sum + BigInt(item.valueSats), 0n) - selection.feeSats
    : input.amountSats

  const publicKey = hexToBytes(input.publicKeyHex.replace(/^0x/, ''))
  const payment = bitcoinPayment(publicKey, input.addressType, input.networkScope)
  const tx = new btc.Transaction({
    allowLegacyWitnessUtxo: input.addressType === 'p2pkh',
  })

  for (const utxo of selection.selected) {
    const prevHex =
      input.addressType === 'p2pkh'
        ? utxo.rawTxHex ?? (await fetchTxHex(utxo.txid, input.networkScope))
        : undefined
    tx.addInput({
      txid: hexToBytes(utxo.txid),
      index: utxo.vout,
      witnessUtxo: {
        script: payment.script,
        amount: BigInt(utxo.valueSats),
      },
      ...(prevHex ? { nonWitnessUtxo: hexToBytes(prevHex) } : {}),
      ...(input.addressType === 'p2sh-p2wpkh'
        ? { redeemScript: btc.p2wpkh(publicKey, networkOf(input.networkScope)).script }
        : {}),
      ...(input.addressType === 'p2tr' ? { tapInternalKey: toXOnly(publicKey) } : {}),
    })
  }

  tx.addOutputAddress(input.toAddress, sendAmount, networkOf(input.networkScope))
  if (selection.changeSats > 0n) {
    tx.addOutputAddress(input.fromAddress, selection.changeSats, networkOf(input.networkScope))
  }

  tx.sign(input.privateKey)
  tx.finalize()
  return {
    hex: tx.hex,
    feeSats: selection.feeSats,
    vsize: estimateVsize(
      input.addressType,
      selection.selected.length,
      selection.changeSats > 0n ? 2 : 1,
    ),
    changeSats: selection.changeSats,
  }
}

export async function broadcastBitcoinTx(rawTxHex: string, networkScope: NetworkScope): Promise<string> {
  const result = await providerPost<unknown>(esplora(networkScope, 'tx'), undefined, {
    rawBody: rawTxHex,
  })
  const txid = typeof result === 'string' ? result.trim() : String((result as { txid?: string }).txid ?? '')
  if (!/^[a-f0-9]{64}$/i.test(txid)) throw new Error(`广播成功但未返回合法 txid：${txid}`)
  return txid
}

export function explorerUrlForBitcoin(txid: string, networkScope: NetworkScope, browser: string | null): string | null {
  if (browser) return `${browser.replace(/\/+$/, '')}/tx/${txid}`
  return networkScope === 'mainnet'
    ? `https://mempool.space/tx/${txid}`
    : `https://mempool.space/testnet/tx/${txid}`
}
