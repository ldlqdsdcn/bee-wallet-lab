/**
 * 开发工具：JSON 格式化、Hex 转换、常用哈希。不访问节点。
 */
import { sha256, sha512 } from '@noble/hashes/sha2'
import { keccak_256, sha3_256 } from '@noble/hashes/sha3'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { blake2b } from '@noble/hashes/blake2b'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils'
import type {
  DevConvertMode,
  DevConvertResult,
  DevHashItem,
  DevHashResult,
  DevJsonKind,
  DevJsonResult,
} from '@shared/types'

const MAX_CHARS = 1_000_000

function requireText(raw: string, label: string): string {
  const text = raw ?? ''
  if (text.length > MAX_CHARS) throw new Error(`${label}过长`)
  return text
}

function jsonKind(value: unknown): DevJsonKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'null'
}

export function formatJson(raw: string): DevJsonResult {
  const text = requireText(raw, 'JSON').trim()
  if (!text) throw new Error('JSON 不能为空')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(err instanceof Error ? `JSON 不合法：${err.message}` : 'JSON 不合法')
  }
  return {
    pretty: JSON.stringify(parsed, null, 2),
    minified: JSON.stringify(parsed),
    kind: jsonKind(parsed),
    parsed,
  }
}

function parseHexBytes(raw: string): Uint8Array {
  const hex = raw.trim().replace(/^0x/i, '').replace(/\s+/g, '')
  if (!hex) return new Uint8Array()
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error('十六进制不合法')
  return hexToBytes(hex)
}

function parseUtf8Bytes(raw: string): Uint8Array {
  return utf8ToBytes(raw)
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function convertBytes(mode: DevConvertMode, value: string): DevConvertResult {
  const text = requireText(value, '输入')
  if (mode === 'utf8-to-hex') {
    const bytes = parseUtf8Bytes(text)
    return { mode, output: `0x${bytesToHex(bytes)}`, bytes: bytes.length }
  }
  if (mode === 'hex-to-utf8') {
    const bytes = parseHexBytes(text)
    return { mode, output: bytesToUtf8(bytes), bytes: bytes.length }
  }
  if (mode === 'hex-to-base64') {
    const bytes = parseHexBytes(text)
    return { mode, output: Buffer.from(bytes).toString('base64'), bytes: bytes.length }
  }
  const compact = text.trim().replace(/\s+/g, '')
  if (!compact) return { mode, output: '0x', bytes: 0 }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error('Base64 不合法')
  }
  const bytes = Uint8Array.from(Buffer.from(compact, 'base64'))
  return { mode, output: `0x${bytesToHex(bytes)}`, bytes: bytes.length }
}

function hashHex(bytes: Uint8Array, digest: (data: Uint8Array) => Uint8Array): string {
  return `0x${bytesToHex(digest(bytes))}`
}

export function hashBytes(value: string, encoding: 'utf8' | 'hex'): DevHashResult {
  const text = requireText(value, '输入')
  const bytes = encoding === 'hex' ? parseHexBytes(text) : parseUtf8Bytes(text)
  const hashes: DevHashItem[] = [
    { algo: 'sha256', label: 'SHA-256', hex: hashHex(bytes, sha256) },
    { algo: 'keccak256', label: 'Keccak-256', hex: hashHex(bytes, keccak_256) },
    { algo: 'sha512', label: 'SHA-512', hex: hashHex(bytes, sha512) },
    { algo: 'sha3-256', label: 'SHA3-256', hex: hashHex(bytes, sha3_256) },
    { algo: 'ripemd160', label: 'RIPEMD-160', hex: hashHex(bytes, ripemd160) },
    { algo: 'blake2b', label: 'BLAKE2b', hex: hashHex(bytes, (data) => blake2b(data, { dkLen: 32 })) },
  ]
  return { bytes: bytes.length, hashes }
}
