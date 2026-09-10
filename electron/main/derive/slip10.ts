/**
 * SLIP-0010 Ed25519 私钥派生。Solana 不能走 @scure/bip32（那是 secp256k1 BIP-32）。
 * 只支持硬化路径，与 Phantom / Solflare 默认 m/44'/501'/account'/address' 一致。
 */
import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha2'

const ED25519_SEED = new TextEncoder().encode('ed25519 seed')
const HARDENED = 0x80000000

export function slip10Master(seed: Uint8Array): { key: Uint8Array; chainCode: Uint8Array } {
  const I = hmac(sha512, ED25519_SEED, seed)
  return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

function deriveHardened(
  parent: { key: Uint8Array; chainCode: Uint8Array },
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
  if (index < 0 || index > 0x7fffffff) throw new Error('SLIP-0010 索引越界')
  const data = new Uint8Array(1 + 32 + 4)
  data[0] = 0
  data.set(parent.key, 1)
  const hardened = (index + HARDENED) >>> 0
  data[33] = (hardened >>> 24) & 0xff
  data[34] = (hardened >>> 16) & 0xff
  data[35] = (hardened >>> 8) & 0xff
  data[36] = hardened & 0xff
  const I = hmac(sha512, parent.chainCode, data)
  return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

export function slip10DeriveNode(
  seed: Uint8Array,
  path: string,
): { key: Uint8Array; chainCode: Uint8Array } {
  const normalized = path.trim().replace(/h/g, "'")
  if (normalized !== 'm' && !/^m(\/\d+')+$/.test(normalized)) {
    throw new Error(`Solana 派生路径必须全部硬化：${path}`)
  }
  let node = slip10Master(seed)
  if (normalized === 'm') return node
  for (const segment of normalized.split('/').slice(1)) {
    node = deriveHardened(node, Number.parseInt(segment, 10))
  }
  return node
}

export function slip10DeriveHardenedChild(
  parent: { key: Uint8Array; chainCode: Uint8Array },
  index: number,
): { key: Uint8Array; chainCode: Uint8Array } {
  return deriveHardened(parent, index)
}

/** 解析 m/44'/501'/0'/0' 这类全硬化路径，返回 32 字节私钥种子 */
export function slip10DeriveEd25519(seed: Uint8Array, path: string): Uint8Array {
  return slip10DeriveNode(seed, path).key
}
