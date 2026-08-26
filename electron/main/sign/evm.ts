/**
 * EIP-191 personal_sign。鉴权（R0）与消息签名页（R7.2）共用同一套实现。
 *
 * 口径：
 *   hash = keccak256("\x19Ethereum Signed Message:\n" + byteLength + message)
 *   签名输出 65 字节 r(32) || s(32) || v(1)，v = recovery + 27，与 ethers 一致。
 *
 * 注意：字符串消息按 UTF-8 编码，不做 hex 解析。
 * 后端 /auth/authenticate 待签的是 keccak hash 的「hex 字符串文本」，
 * 正好落在这个口径上，不要误当成 32 字节摘要。
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import { evmAddressFromPublicKey, toChecksumAddress } from '../derive/evm'

const PERSONAL_PREFIX = '\x19Ethereum Signed Message:\n'

export function toMessageBytes(message: string | Uint8Array): Uint8Array {
  return typeof message === 'string' ? utf8ToBytes(message) : message
}

/** EIP-191 前缀哈希，UI 上展示「待签摘要」用的就是这个值 */
export function hashPersonalMessage(message: string | Uint8Array): Uint8Array {
  const body = toMessageBytes(message)
  return keccak_256(concatBytes(utf8ToBytes(`${PERSONAL_PREFIX}${body.length}`), body))
}

export function hashPersonalMessageHex(message: string | Uint8Array): string {
  return `0x${bytesToHex(hashPersonalMessage(message))}`
}

/** 返回 0x 前缀的 65 字节签名 */
export function personalSign(privateKey: Uint8Array, message: string | Uint8Array): string {
  const signature = secp256k1.sign(hashPersonalMessage(message), privateKey, { prehash: false })
  const v = (signature.recovery + 27).toString(16).padStart(2, '0')
  return `0x${bytesToHex(signature.toBytes('compact'))}${v}`
}

/** 拆出 r||s 与 recovery bit，同时兼容 v = 0/1 与 27/28 两种写法 */
export function splitSignature(signature: string): { compact: Uint8Array; recovery: number } {
  const body = signature.trim().replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{130}$/.test(body)) {
    throw new Error('签名格式不合法，应为 65 字节 hex')
  }
  const bytes = hexToBytes(body.toLowerCase())
  const raw = bytes[64]
  const recovery = raw >= 27 ? raw - 27 : raw
  if (recovery !== 0 && recovery !== 1) {
    throw new Error(`签名 v 值不合法：${raw}`)
  }
  return { compact: bytes.subarray(0, 64), recovery }
}

export function recoverPersonalSignAddress(
  message: string | Uint8Array,
  signature: string,
): string {
  const { compact, recovery } = splitSignature(signature)
  const publicKey = secp256k1.Signature.fromBytes(compact, 'compact')
    .addRecoveryBit(recovery)
    .recoverPublicKey(hashPersonalMessage(message))
  return evmAddressFromPublicKey(publicKey.toBytes(false))
}

/** 地址比对忽略大小写，避免调用方传了非 checksum 地址就判失败 */
export function verifyPersonalSign(
  message: string | Uint8Array,
  signature: string,
  address: string,
): boolean {
  try {
    return (
      recoverPersonalSignAddress(message, signature).toLowerCase() ===
      toChecksumAddress(address).toLowerCase()
    )
  } catch {
    return false
  }
}
