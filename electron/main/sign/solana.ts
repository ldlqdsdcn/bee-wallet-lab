/**
 * Solana 链下消息：对 UTF-8 原文做 Ed25519 签名，签名用 Base58。
 */
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { base58 } from '@scure/base'
import { isSolanaAddress } from '../derive/solana'

function decodeSignature(signature: string): Uint8Array {
  const trimmed = signature.trim()
  const hex = trimmed.replace(/^0x/, '')
  if (/^[0-9a-fA-F]{128}$/.test(hex)) {
    const out = new Uint8Array(64)
    for (let i = 0; i < 64; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return out
  }
  const decoded = base58.decode(trimmed)
  if (decoded.length !== 64) throw new Error('Solana 签名长度无效')
  return decoded
}

export function signSolanaMessage(privateKey: Uint8Array, message: string): string {
  return base58.encode(ed25519.sign(utf8ToBytes(message), privateKey))
}

export function solanaMessageDigestHex(message: string): string {
  return `0x${bytesToHex(sha256(utf8ToBytes(message)))}`
}

export function verifySolanaMessage(
  message: string,
  signature: string,
  address: string,
): { valid: boolean; recoveredAddress: string | null } {
  if (!isSolanaAddress(address)) throw new Error('Solana 地址格式不合法')
  try {
    const publicKey = base58.decode(address.trim())
    const valid = ed25519.verify(decodeSignature(signature), utf8ToBytes(message), publicKey)
    return { valid, recoveredAddress: valid ? address.trim() : null }
  } catch {
    return { valid: false, recoveredAddress: null }
  }
}
