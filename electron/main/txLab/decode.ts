/**
 * 交易实验室：按链解析已签名 / 未签名原始交易。不访问节点。
 */
import { keccak256, parseTransaction, type Hex } from 'viem'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { base58 } from '@scure/base'
import * as btc from '@scure/btc-signer'
import type { TxLabDecoded, TxLabRawFormat, WalletType } from '@shared/types'
import { asRecord, asString } from '../backend/list'
import { bitcoinTxidFromHex } from '../chain/bitcoin'

const ZERO_SIG = new Uint8Array(64)

export function normalizeBroadcastRaw(walletType: WalletType, raw: string): string {
  const trimmed = raw.trim()
  if (walletType === 'web3') {
    const hex = trimmed.replace(/\s+/g, '')
    return hex.startsWith('0x') ? hex : `0x${hex}`
  }
  if (walletType === 'bitcoin') return trimmed.replace(/^0x/i, '').replace(/\s+/g, '')
  if (walletType === 'solana') {
    const hex = trimmed.replace(/^0x/i, '').replace(/\s+/g, '')
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length >= 16 && !trimmed.includes('=')) {
      return Buffer.from(hex, 'hex').toString('base64')
    }
    return trimmed
  }
  return trimmed
}

export function decodeRawTransaction(walletType: WalletType, raw: string): TxLabDecoded {
  const text = raw.trim()
  if (!text) throw new Error('原始交易不能为空')
  if (walletType === 'web3') return decodeEvm(text)
  if (walletType === 'bitcoin') return decodeBitcoin(text)
  if (walletType === 'solana') return decodeSolana(text)
  return decodeTron(text)
}

function result(
  walletType: WalletType,
  raw: string,
  rawFormat: TxLabRawFormat,
  txid: string | null,
  signed: boolean,
  fields: Record<string, string>,
  warnings: string[] = [],
): TxLabDecoded {
  return {
    walletType,
    networkPk: '',
    raw,
    rawFormat,
    txid,
    signed,
    fields,
    warnings: signed ? warnings : ['交易尚未签名，不能广播', ...warnings],
  }
}

function stripHex(value: string): string {
  return value.trim().replace(/^0x/i, '').replace(/\s+/g, '')
}

function decodeEvm(raw: string): TxLabDecoded {
  const hex = stripHex(raw)
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 10 || hex.length % 2 !== 0) {
    throw new Error('EVM 原始交易必须是十六进制')
  }
  const prefixed = `0x${hex}` as Hex
  const tx = parseTransaction(prefixed)
  const signed = Boolean(tx.r && tx.s)
  const fields: Record<string, string> = {
    type: String(tx.type ?? 'legacy'),
    chainId: tx.chainId != null ? String(tx.chainId) : '',
    nonce: tx.nonce != null ? String(tx.nonce) : '',
    to: tx.to ?? '',
    value: tx.value != null ? tx.value.toString() : '0',
    gas: tx.gas != null ? tx.gas.toString() : '',
    data: tx.data && tx.data !== '0x' ? tx.data : '',
  }
  if (tx.maxFeePerGas != null) fields.maxFeePerGas = tx.maxFeePerGas.toString()
  if (tx.maxPriorityFeePerGas != null) fields.maxPriorityFeePerGas = tx.maxPriorityFeePerGas.toString()
  if (tx.gasPrice != null) fields.gasPrice = tx.gasPrice.toString()
  if (signed) {
    fields.r = String(tx.r)
    fields.s = String(tx.s)
    if (tx.v != null) fields.v = String(tx.v)
  }
  return result('web3', prefixed, 'hex', signed ? keccak256(prefixed) : null, signed, fields)
}

function decodeBitcoin(raw: string): TxLabDecoded {
  const hex = stripHex(raw)
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 20 || hex.length % 2 !== 0) {
    throw new Error('Bitcoin 原始交易必须是十六进制')
  }
  const bytes = hexToBytes(hex)
  const tx = btc.Transaction.fromRaw(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true })
  const inputCount = tx.inputsLength
  const outputCount = tx.outputsLength
  const outputAmounts: string[] = []
  let signed = false
  for (let i = 0; i < inputCount; i += 1) {
    const input = tx.getInput(i)
    if (
      (input.finalScriptSig && input.finalScriptSig.length > 0) ||
      (input.finalScriptWitness && input.finalScriptWitness.length > 0)
    ) {
      signed = true
    }
  }
  for (let i = 0; i < outputCount; i += 1) {
    const out = tx.getOutput(i)
    outputAmounts.push(out.amount != null ? out.amount.toString() : '?')
  }
  const txid = bitcoinTxidFromHex(hex)
  return result(
    'bitcoin',
    hex,
    'hex',
    txid,
    signed,
    {
      version: String(tx.version ?? ''),
      inputs: String(inputCount),
      outputs: String(outputCount),
      outputAmounts: outputAmounts.join(', '),
      lockTime: String(tx.lockTime ?? ''),
    },
  )
}

function decodeTron(raw: string): TxLabDecoded {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('TRON 原始交易必须是 JSON')
  }
  const tx = asRecord(parsed)
  if (!tx) throw new Error('TRON 原始交易 JSON 无效')
  const rawData = asRecord(tx.raw_data)
  const contracts = Array.isArray(rawData?.contract) ? rawData.contract : []
  const first = asRecord(contracts[0])
  const parameter = asRecord(first?.parameter)
  const value = asRecord(parameter?.value) ?? {}
  const signatures = Array.isArray(tx.signature) ? tx.signature.filter((item) => typeof item === 'string' && item) : []
  const signed = signatures.length > 0
  const txid = asString(tx.txID ?? tx.txid) || null
  return result(
    'tron',
    JSON.stringify(tx),
    'json',
    txid,
    signed,
    {
      txID: txid ?? '',
      type: asString(first?.type),
      from: asString(value.owner_address),
      to: asString(value.to_address),
      amount: value.amount != null ? String(value.amount) : '',
      contract: asString(value.contract_address),
      feeLimit: rawData?.fee_limit != null ? String(rawData.fee_limit) : asString(tx.fee_limit),
      signatures: String(signatures.length),
    },
  )
}

function decodeSolana(raw: string): TxLabDecoded {
  const bytes = parseSolanaBytes(raw)
  const format: TxLabRawFormat = looksLikeHex(raw) ? 'hex' : 'base64'
  const display = format === 'hex' ? bytesToHex(bytes) : Buffer.from(bytes).toString('base64')
  const parsed = parseSolanaWire(bytes)
  return result('solana', display, format, parsed.txid, parsed.signed, parsed.fields, parsed.warnings)
}

function looksLikeHex(raw: string): boolean {
  const hex = stripHex(raw)
  return hex.length % 2 === 0 && hex.length >= 16 && /^[0-9a-fA-F]+$/.test(hex) && !raw.trim().includes('=')
}

function parseSolanaBytes(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (looksLikeHex(trimmed)) return hexToBytes(stripHex(trimmed))
  try {
    const fromB64 = Buffer.from(trimmed, 'base64')
    if (fromB64.length >= 65) return Uint8Array.from(fromB64)
  } catch {
    /* 再试 base58 */
  }
  try {
    return base58.decode(trimmed)
  } catch {
    throw new Error('Solana 原始交易必须是 Base64、Hex 或 Base58')
  }
}

function parseSolanaWire(bytes: Uint8Array): {
  txid: string | null
  signed: boolean
  fields: Record<string, string>
  warnings: string[]
} {
  const sigs = readCompactU16(bytes, 0)
  if (sigs.value < 1 || sigs.value > 32) throw new Error('Solana 签名数量不合法')
  let offset = sigs.next
  const signatures: Uint8Array[] = []
  for (let i = 0; i < sigs.value; i += 1) {
    if (offset + 64 > bytes.length) throw new Error('Solana 签名区不完整')
    signatures.push(bytes.subarray(offset, offset + 64))
    offset += 64
  }
  if (offset >= bytes.length) throw new Error('Solana message 缺失')
  const signed = signatures.some((sig) => !isZeroBytes(sig))
  const txid = signed ? base58.encode(signatures[0]) : null

  let version = 'legacy'
  if ((bytes[offset] & 0x80) !== 0) {
    version = `v${bytes[offset] & 0x7f}`
    offset += 1
  }
  if (offset + 3 > bytes.length) throw new Error('Solana message header 不完整')
  const numRequired = bytes[offset]
  const numReadonlySigned = bytes[offset + 1]
  const numReadonlyUnsigned = bytes[offset + 2]
  offset += 3

  const accountCount = readCompactU16(bytes, offset)
  offset = accountCount.next
  const accounts: string[] = []
  for (let i = 0; i < accountCount.value; i += 1) {
    if (offset + 32 > bytes.length) throw new Error('Solana 账户列表不完整')
    accounts.push(base58.encode(bytes.subarray(offset, offset + 32)))
    offset += 32
  }
  if (offset + 32 > bytes.length) throw new Error('Solana recent blockhash 缺失')
  const blockhash = base58.encode(bytes.subarray(offset, offset + 32))
  offset += 32

  const ixCount = readCompactU16(bytes, offset)
  offset = ixCount.next
  const instructions: string[] = []
  for (let i = 0; i < ixCount.value; i += 1) {
    if (offset >= bytes.length) throw new Error('Solana instruction 不完整')
    const programIndex = bytes[offset]
    offset += 1
    const acc = readCompactU16(bytes, offset)
    offset = acc.next + acc.value
    const data = readCompactU16(bytes, offset)
    const dataBytes = bytes.subarray(data.next, data.next + data.value)
    offset = data.next + data.value
    const program = accounts[programIndex] ?? `#${programIndex}`
    instructions.push(`${program} data=${bytesToHex(dataBytes) || 'empty'}`)
  }

  const warnings: string[] = []
  if (version !== 'legacy') warnings.push(`解析了 ${version} 交易，地址表未展开`)

  return {
    txid,
    signed,
    warnings,
    fields: {
      version,
      signatures: String(signatures.length),
      requiredSignatures: String(numRequired),
      readonlySigned: String(numReadonlySigned),
      readonlyUnsigned: String(numReadonlyUnsigned),
      feePayer: accounts[0] ?? '',
      accounts: accounts.join(', '),
      recentBlockhash: blockhash,
      instructions: String(ixCount.value),
      instruction0: instructions[0] ?? '',
    },
  }
}

function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let next = offset
  for (let i = 0; i < 3; i += 1) {
    if (next >= bytes.length) throw new Error('compact-u16 超出范围')
    const elem = bytes[next]
    next += 1
    value |= (elem & 0x7f) << shift
    if ((elem & 0x80) === 0) return { value, next }
    shift += 7
  }
  throw new Error('compact-u16 不合法')
}

function isZeroBytes(bytes: Uint8Array): boolean {
  if (bytes.length !== ZERO_SIG.length) return bytes.every((item) => item === 0)
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) return false
  }
  return true
}
