/**
 * Bitcoin 消息签名：BIP-137（Electrum / Bitcoin Core 的 `signmessage` 口径）。
 *
 * flag：
 *   31-34  compressed P2PKH
 *   35-38  P2SH-P2WPKH
 *   39-42  P2WPKH / 本实验室对 P2TR 也复用这一档
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils'
import type { BitcoinAddressType, NetworkScope } from '@shared/types'
import { bitcoinAddressFromPublicKey } from '../derive/bitcoin'

const MAGIC = 'Bitcoin Signed Message:\n'

function encodeVarInt(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.of(value)
  if (value <= 0xffff) {
    const out = new Uint8Array(3)
    out[0] = 0xfd
    out[1] = value & 0xff
    out[2] = (value >> 8) & 0xff
    return out
  }
  const out = new Uint8Array(5)
  out[0] = 0xfe
  new DataView(out.buffer).setUint32(1, value, true)
  return out
}

export function bitcoinMessageHash(message: string): Uint8Array {
  const prefix = utf8ToBytes(MAGIC)
  const body = utf8ToBytes(message)
  return sha256(sha256(concatBytes(encodeVarInt(prefix.length), prefix, encodeVarInt(body.length), body)))
}

function headerFlag(addressType: BitcoinAddressType, recovery: number): number {
  const rec = recovery & 0x03
  if (addressType === 'p2sh-p2wpkh') return 35 + rec
  if (addressType === 'p2wpkh' || addressType === 'p2tr') return 39 + rec
  return 31 + rec
}

export function signBitcoinMessage(
  privateKey: Uint8Array,
  message: string,
  addressType: BitcoinAddressType,
): string {
  const signature = secp256k1.sign(bitcoinMessageHash(message), privateKey, { prehash: false })
  const bytes = concatBytes(Uint8Array.of(headerFlag(addressType, signature.recovery)), signature.toBytes('compact'))
  return Buffer.from(bytes).toString('base64')
}

export function recoverBitcoinMessagePublicKey(message: string, signature: string): {
  publicKey: Uint8Array
  addressTypeHint: BitcoinAddressType
} {
  const raw = Buffer.from(signature.trim(), 'base64')
  if (raw.length !== 65) throw new Error('Bitcoin 签名格式不合法，应为 65 字节 Base64')
  const flag = raw[0]
  const recovery = (flag - 27) & 3
  const compressed = flag >= 31
  const compact = raw.subarray(1)
  const publicKey = secp256k1.Signature.fromBytes(compact, 'compact')
    .addRecoveryBit(recovery)
    .recoverPublicKey(bitcoinMessageHash(message))
    .toBytes(compressed)
  const addressTypeHint: BitcoinAddressType =
    flag >= 39 ? 'p2wpkh' : flag >= 35 ? 'p2sh-p2wpkh' : 'p2pkh'
  return { publicKey, addressTypeHint }
}

export function verifyBitcoinMessage(
  message: string,
  signature: string,
  address: string,
  networkScope: NetworkScope,
  addressType?: BitcoinAddressType | null,
): { valid: boolean; recoveredAddress: string | null } {
  try {
    const recovered = recoverBitcoinMessagePublicKey(message, signature)
    const types: BitcoinAddressType[] = addressType
      ? [addressType]
      : ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr']
    for (const type of types) {
      const derived = bitcoinAddressFromPublicKey(recovered.publicKey, type, networkScope)
      if (derived === address) return { valid: true, recoveredAddress: derived }
    }
    const fallback = bitcoinAddressFromPublicKey(
      recovered.publicKey,
      recovered.addressTypeHint,
      networkScope,
    )
    return { valid: false, recoveredAddress: fallback }
  } catch {
    return { valid: false, recoveredAddress: null }
  }
}
