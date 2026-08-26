/**
 * 加密基础设施。
 *
 * 口径：
 * - 主密码 -> KEK：scrypt(N=32768, r=8, p=1, keylen=32)，salt 16 字节随机
 * - 敏感数据：AES-256-GCM，密文封装为 `v1.<iv>.<tag>.<ciphertext>`（均为 base64）
 * - 主密码校验：HMAC-SHA256(KEK, VERIFY_LABEL)，只存校验值，不存 KEK
 *
 * 该模块只负责纯算法，不持有任何长期状态。
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

export const KDF_ALGORITHM = 'scrypt'
export const KDF_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keyLength: 32,
  /** scrypt 内存上限，N*r*128*2 才够用，留出余量 */
  maxmem: 96 * 1024 * 1024,
} as const

const CIPHER_ALGORITHM = 'aes-256-gcm'
const CIPHER_VERSION = 'v1'
const IV_LENGTH = 12
const SALT_LENGTH = 16
const VERIFY_LABEL = 'bee-wallet-lab/vault-verifier/v1'

export interface KdfDescriptor {
  algorithm: string
  /** base64 */
  salt: string
  N: number
  r: number
  p: number
  keyLength: number
}

export function createKdfDescriptor(): KdfDescriptor {
  return {
    algorithm: KDF_ALGORITHM,
    salt: randomBytes(SALT_LENGTH).toString('base64'),
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p,
    keyLength: KDF_PARAMS.keyLength,
  }
}

/** 由主密码与 KDF 参数派生 KEK。返回值是敏感数据，用完应尽快 wipe。 */
export function deriveKek(password: string, kdf: KdfDescriptor): Buffer {
  if (kdf.algorithm !== KDF_ALGORITHM) {
    throw new Error(`unsupported kdf algorithm: ${kdf.algorithm}`)
  }
  return scryptSync(password.normalize('NFKD'), Buffer.from(kdf.salt, 'base64'), kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: KDF_PARAMS.maxmem,
  })
}

/** 生成主密码校验值，用于解锁时判断密码是否正确。 */
export function createVerifier(kek: Buffer): string {
  return createHmac('sha256', kek).update(VERIFY_LABEL).digest('base64')
}

export function verifyKek(kek: Buffer, verifier: string): boolean {
  const expected = Buffer.from(verifier, 'base64')
  const actual = Buffer.from(createVerifier(kek), 'base64')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/**
 * AES-256-GCM 加密。
 * @param aad 附加认证数据，通常传入记录 id，防止密文被跨记录搬运
 */
export function encryptSecret(kek: Buffer, plaintext: string | Buffer, aad?: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(CIPHER_ALGORITHM, kek, iv)
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'))
  const input = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    CIPHER_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.')
}

export function decryptSecretBuffer(kek: Buffer, packed: string, aad?: string): Buffer {
  const parts = packed.split('.')
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    throw new Error('malformed ciphertext')
  }
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const ciphertext = Buffer.from(parts[3], 'base64')
  const decipher = createDecipheriv(CIPHER_ALGORITHM, kek, iv)
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export function decryptSecret(kek: Buffer, packed: string, aad?: string): string {
  const buf = decryptSecretBuffer(kek, packed, aad)
  const text = buf.toString('utf8')
  wipe(buf)
  return text
}

/** 尽力清零敏感缓冲区。 */
export function wipe(...buffers: (Buffer | Uint8Array | null | undefined)[]): void {
  for (const buf of buffers) {
    if (buf && buf.length > 0) buf.fill(0)
  }
}

export function newId(): string {
  return randomUUID()
}

/** 密码强度校验：至少 8 位，且包含字母与数字。 */
export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('主密码至少需要 8 个字符')
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('主密码需同时包含字母与数字')
  }
}
