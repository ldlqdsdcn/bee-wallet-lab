import { describe, expect, it } from 'vitest'
import {
  assertPasswordStrength,
  createKdfDescriptor,
  createVerifier,
  decryptSecret,
  deriveKek,
  encryptSecret,
  verifyKek,
  wipe,
} from '../electron/main/security/crypto'

/**
 * 安全基座回归测试：KDF 确定性、密码校验、AES-GCM 完整性。
 * 用较小的 scrypt 参数以保证测试速度，算法路径与生产一致。
 */
const fastKdf = () => ({ ...createKdfDescriptor(), N: 1024 })

describe('crypto', () => {
  it('相同密码与 salt 派生出相同 KEK', () => {
    const kdf = fastKdf()
    expect(deriveKek('pass1234', kdf).toString('hex')).toBe(deriveKek('pass1234', kdf).toString('hex'))
  })

  it('不同 salt 派生出不同 KEK', () => {
    const a = deriveKek('pass1234', fastKdf())
    const b = deriveKek('pass1234', fastKdf())
    expect(a.toString('hex')).not.toBe(b.toString('hex'))
  })

  it('verifier 只接受正确密码', () => {
    const kdf = fastKdf()
    const verifier = createVerifier(deriveKek('pass1234', kdf))
    expect(verifyKek(deriveKek('pass1234', kdf), verifier)).toBe(true)
    expect(verifyKek(deriveKek('wrong1234', kdf), verifier)).toBe(false)
  })

  it('AES-GCM 加解密可往返，且 AAD 必须匹配', () => {
    const kek = deriveKek('pass1234', fastKdf())
    const mnemonic = 'abandon abandon abandon abandon abandon about'
    const packed = encryptSecret(kek, mnemonic, 'wallet-1')

    expect(packed.startsWith('v1.')).toBe(true)
    expect(packed).not.toContain('abandon')
    expect(decryptSecret(kek, packed, 'wallet-1')).toBe(mnemonic)
    expect(() => decryptSecret(kek, packed, 'wallet-2')).toThrow()
  })

  it('密文被篡改时解密失败', () => {
    const kek = deriveKek('pass1234', fastKdf())
    const packed = encryptSecret(kek, 'secret-value')
    const parts = packed.split('.')
    const raw = Buffer.from(parts[3], 'base64')
    raw[0] ^= 0xff
    parts[3] = raw.toString('base64')
    expect(() => decryptSecret(kek, parts.join('.'))).toThrow()
  })

  it('换密码后旧 KEK 无法解密新密文', () => {
    const kdf = fastKdf()
    const oldKek = deriveKek('pass1234', kdf)
    const newKek = deriveKek('next5678', fastKdf())
    const packed = encryptSecret(newKek, 'secret-value')
    expect(() => decryptSecret(oldKek, packed)).toThrow()
  })

  it('wipe 清零缓冲区', () => {
    const buf = Buffer.from('sensitive')
    wipe(buf)
    expect(buf.every((byte) => byte === 0)).toBe(true)
  })

  it('拒绝弱主密码', () => {
    expect(() => assertPasswordStrength('short1')).toThrow()
    expect(() => assertPasswordStrength('onlyletters')).toThrow()
    expect(() => assertPasswordStrength('12345678')).toThrow()
    expect(() => assertPasswordStrength('good1234')).not.toThrow()
  })
})
