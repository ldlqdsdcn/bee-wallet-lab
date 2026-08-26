/**
 * EVM 地址：keccak256(未压缩公钥去掉 0x04 前缀) 取后 20 字节，再按 EIP-55 混合大小写。
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/

/** EIP-55 校验和：hash 的第 i 个 nibble >= 8 则第 i 个字符大写 */
export function toChecksumAddress(address: string): string {
  const lower = address.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{40}$/.test(lower)) {
    throw new Error(`EVM 地址格式不合法：${address}`)
  }
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)))
  let out = '0x'
  for (let i = 0; i < lower.length; i += 1) {
    out += Number.parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
  }
  return out
}

export function evmAddressFromPublicKey(publicKey: Uint8Array): string {
  // 统一转成 65 字节未压缩格式（0x04 || X || Y）
  const point = secp256k1.Point.fromBytes(publicKey).toBytes(false)
  const raw = keccak_256(point.subarray(1)).subarray(-20)
  return toChecksumAddress(bytesToHex(raw))
}

export function evmAddressFromPrivateKey(privateKey: Uint8Array): string {
  return evmAddressFromPublicKey(secp256k1.getPublicKey(privateKey, false))
}

/** 未压缩公钥 hex（0x04...），与移动端 ethers signingKey.publicKey 口径一致 */
export function evmPublicKeyHex(privateKey: Uint8Array): string {
  return `0x${bytesToHex(secp256k1.getPublicKey(privateKey, false))}`
}

export function isEvmAddress(value: string): boolean {
  return ADDRESS_SHAPE.test(value.trim())
}

/** 严格校验：形态合法且校验和匹配（全大写或全小写视为未加校验和，放行） */
export function isChecksumValid(address: string): boolean {
  const trimmed = address.trim()
  if (!isEvmAddress(trimmed)) return false
  const body = trimmed.slice(2)
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true
  return toChecksumAddress(trimmed) === trimmed
}
