/**
 * Solana 地址：Ed25519 公钥的 Base58（无校验和），与 Phantom 一致。
 */
import { ed25519 } from '@noble/curves/ed25519'
import { base58 } from '@scure/base'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

const ADDRESS_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function solanaPublicKey(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) throw new Error('Solana 私钥必须是 32 字节种子')
  return ed25519.getPublicKey(privateKey)
}

export function solanaAddressFromPrivateKey(privateKey: Uint8Array): string {
  return base58.encode(solanaPublicKey(privateKey))
}

export function solanaPublicKeyHex(privateKey: Uint8Array): string {
  return bytesToHex(solanaPublicKey(privateKey))
}

export function isSolanaAddress(value: string): boolean {
  const trimmed = value.trim()
  if (!ADDRESS_SHAPE.test(trimmed)) return false
  try {
    return base58.decode(trimmed).length === 32
  } catch {
    return false
  }
}

/** Phantom / solana-keygen 常用：Base58(seed || pubkey) 或 32/64 字节 hex */
export function parseSolanaPrivateKey(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (/^\d+(,\s*\d+){31,63}$/.test(trimmed) || trimmed.startsWith('[')) {
    const nums = trimmed
      .replace(/[[\]]/g, '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item))
    if (nums.length === 32 || nums.length === 64) {
      if (nums.some((item) => item < 0 || item > 255)) throw new Error('Solana 私钥字节越界')
      return Uint8Array.from(nums.slice(0, 32))
    }
  }
  const hexBody = trimmed.replace(/^0x/, '')
  if (/^[0-9a-fA-F]{64}$/.test(hexBody)) return hexToBytes(hexBody.toLowerCase())
  if (/^[0-9a-fA-F]{128}$/.test(hexBody)) return hexToBytes(hexBody.toLowerCase()).slice(0, 32)
  try {
    const decoded = base58.decode(trimmed)
    if (decoded.length === 32 || decoded.length === 64) return decoded.slice(0, 32)
  } catch {
    /* 不是 Base58 */
  }
  throw new Error('Solana 私钥格式不合法，应为 32 字节 hex、64 字节 secret key 或 Base58')
}

/** 导出 Phantom 可导入的 64 字节 secret key（Base58） */
export function encodeSolanaSecretKey(privateKey: Uint8Array): string {
  const publicKey = solanaPublicKey(privateKey)
  const secret = new Uint8Array(64)
  secret.set(privateKey, 0)
  secret.set(publicKey, 32)
  return base58.encode(secret)
}
