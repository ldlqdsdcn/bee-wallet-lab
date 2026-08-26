/**
 * TRON 地址：与 EVM 同一把私钥、同一套 keccak256 取后 20 字节，
 * 再前置 0x41 并做 Base58Check（口径与移动端 src/plugins/tron/core.ts 的 toTronAddress 一致）。
 */
import { base58check } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { evmAddressFromPrivateKey, evmAddressFromPublicKey, toChecksumAddress } from './evm'

/** TRON 主网地址版本字节，Base58 编码后固定以 T 开头 */
export const TRON_ADDRESS_PREFIX = 0x41

const base58 = base58check(sha256)

const ADDRESS_SHAPE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/

function encode(rawAddress: Uint8Array): string {
  const payload = new Uint8Array(21)
  payload[0] = TRON_ADDRESS_PREFIX
  payload.set(rawAddress, 1)
  return base58.encode(payload)
}

/** 0x 开头的 EVM 地址 -> T 开头的 TRON 地址 */
export function tronAddressFromEvmAddress(evmAddress: string): string {
  const body = evmAddress.trim().replace(/^0x/, '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(body)) {
    throw new Error(`EVM 地址格式不合法：${evmAddress}`)
  }
  return encode(hexToBytes(body))
}

export function tronAddressFromPublicKey(publicKey: Uint8Array): string {
  return tronAddressFromEvmAddress(evmAddressFromPublicKey(publicKey))
}

export function tronAddressFromPrivateKey(privateKey: Uint8Array): string {
  return tronAddressFromEvmAddress(evmAddressFromPrivateKey(privateKey))
}

/** T 开头地址 -> 41 开头的 hex（TRON 接口常用格式） */
export function tronAddressToHex(address: string): string {
  const payload = base58.decode(address.trim())
  if (payload.length !== 21 || payload[0] !== TRON_ADDRESS_PREFIX) {
    throw new Error(`TRON 地址格式不合法：${address}`)
  }
  return bytesToHex(payload)
}

/** T 开头地址 -> EIP-55 格式的 EVM 地址，便于跨链比对同一把私钥 */
export function tronAddressToEvmAddress(address: string): string {
  return toChecksumAddress(tronAddressToHex(address).slice(2))
}

export function isTronAddress(value: string): boolean {
  const trimmed = value.trim()
  if (!ADDRESS_SHAPE.test(trimmed)) return false
  try {
    tronAddressToHex(trimmed)
    return true
  } catch {
    return false
  }
}
