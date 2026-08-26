/**
 * BIP-39 助记词。库选用 @scure/bip39（审计过、无 Buffer 依赖），
 * 与移动端 bip39@3.1.0 的英文词库和 mnemonicToSeedSync 结果完全一致。
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import type { MnemonicLength } from '@shared/types'

const STRENGTH_BY_WORD_COUNT: Record<number, number> = {
  12: 128,
  15: 160,
  18: 192,
  21: 224,
  24: 256,
}

/** 生成助记词，默认 12 词 */
export function generateMnemonicPhrase(wordCount: 12 | 24 = 12): string {
  const strength = STRENGTH_BY_WORD_COUNT[wordCount]
  if (!strength) throw new Error(`unsupported mnemonic word count: ${wordCount}`)
  return generateMnemonic(wordlist, strength)
}

/**
 * 规范化：NFKD + 去首尾空白 + 折叠连续空白 + 转小写。
 * BIP-39 的 seed 由规范化后的字符串决定，所以入库与派生必须走同一个函数。
 */
export function normalizeMnemonic(phrase: string): string {
  return phrase.normalize('NFKD').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isValidMnemonic(phrase: string): boolean {
  try {
    return validateMnemonic(normalizeMnemonic(phrase), wordlist)
  } catch {
    return false
  }
}

/** 校验并返回规范化后的助记词，非法直接抛错 */
export function assertMnemonic(phrase: string): string {
  const normalized = normalizeMnemonic(phrase)
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('助记词校验失败，请检查单词拼写与顺序')
  }
  return normalized
}

export function mnemonicWordCount(phrase: string): MnemonicLength {
  const count = normalizeMnemonic(phrase).split(' ').length
  if (!STRENGTH_BY_WORD_COUNT[count]) {
    throw new Error(`助记词长度不支持：${count} 词`)
  }
  return count as MnemonicLength
}

/** passphrase 为 BIP-39 的第 25 词，会改变整棵派生树 */
export function mnemonicToSeed(phrase: string, passphrase?: string): Uint8Array {
  return mnemonicToSeedSync(normalizeMnemonic(phrase), passphrase?.normalize('NFKD'))
}

/**
 * 主密钥指纹（BIP-32 fingerprint，8 位小写 hex）。
 * 用于识别「同一助记词重复导入」，比对指纹不需要解密任何密文。
 */
export function masterFingerprint(seed: Uint8Array): string {
  const root = HDKey.fromMasterSeed(seed)
  try {
    return root.fingerprint.toString(16).padStart(8, '0')
  } finally {
    root.wipePrivateData()
  }
}
