/**
 * auth_tokens 仓储：按「鉴权地址 + baseUrl」维度缓存加密后的 JWT。
 *
 * JWT 用 vault KEK 加密落盘，AAD 绑定 address 与 baseUrl，
 * 防止把 A 环境的 token 搬到 B 环境使用。
 */
import { decryptSecret, encryptSecret } from '../../security/crypto'
import { decryptWithVault, encryptWithVault } from '../../security/vault'
import { getDatabase } from '../sqlite'

export interface CachedAuthToken {
  address: string
  baseUrl: string
  token: string
  issuedAt: number
  expiresAt: number
}

interface AuthTokenRow {
  address: string
  base_url: string
  encrypted_token: string
  issued_at: number
  expires_at: number
}

function aadOf(address: string, baseUrl: string): string {
  return `auth:${address}:${baseUrl}`
}

/** 解析 JWT 的 exp（秒 → 毫秒）；解析不出来返回 null，由调用方决定兜底 */
export function parseJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8')) as {
      exp?: unknown
    }
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null
  } catch {
    return null
  }
}

/** 需要解锁态（要 KEK 解密）。锁定期间请改用内存缓存 */
export function loadAuthToken(address: string, baseUrl: string): CachedAuthToken | null {
  const row = getDatabase()
    .prepare<
      [string, string],
      AuthTokenRow
    >('SELECT * FROM auth_tokens WHERE address = ? AND base_url = ?')
    .get(address, baseUrl)
  if (!row) return null
  try {
    return {
      address: row.address,
      baseUrl: row.base_url,
      token: decryptWithVault(row.encrypted_token, aadOf(row.address, row.base_url)),
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    }
  } catch {
    // 密文无法解密（换过主密码或数据损坏）：丢掉这条，让上层重新换 token
    removeAuthToken(address, baseUrl)
    return null
  }
}

export function saveAuthToken(input: {
  address: string
  baseUrl: string
  token: string
  issuedAt?: number
  expiresAt?: number | null
}): CachedAuthToken {
  const issuedAt = input.issuedAt ?? Date.now()
  // 后端签发 30 天；解析不出 exp 时保守按 7 天，宁可多换几次 token
  const expiresAt =
    input.expiresAt ?? parseJwtExpiry(input.token) ?? issuedAt + 7 * 24 * 60 * 60 * 1000
  const encrypted = encryptWithVault(input.token, aadOf(input.address, input.baseUrl))
  getDatabase()
    .prepare(
      `INSERT INTO auth_tokens (address, base_url, encrypted_token, issued_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         base_url        = excluded.base_url,
         encrypted_token = excluded.encrypted_token,
         issued_at       = excluded.issued_at,
         expires_at      = excluded.expires_at`,
    )
    .run(input.address, input.baseUrl, encrypted, issuedAt, expiresAt)
  return { address: input.address, baseUrl: input.baseUrl, token: input.token, issuedAt, expiresAt }
}

export function removeAuthToken(address: string, baseUrl?: string): void {
  const db = getDatabase()
  if (baseUrl === undefined) {
    db.prepare('DELETE FROM auth_tokens WHERE address = ?').run(address)
    return
  }
  db.prepare('DELETE FROM auth_tokens WHERE address = ? AND base_url = ?').run(address, baseUrl)
}

export function clearAuthTokens(): void {
  getDatabase().prepare('DELETE FROM auth_tokens').run()
}

/**
 * 改主密码时在同一事务内重加密。
 * 解不开的行直接删除 —— JWT 可以重新换取，没有丢失风险。
 */
export function reencryptAuthTokens(oldKek: Buffer, newKek: Buffer): void {
  const db = getDatabase()
  const rows = db.prepare<[], AuthTokenRow>('SELECT * FROM auth_tokens').all()
  const update = db.prepare('UPDATE auth_tokens SET encrypted_token = ? WHERE address = ?')
  const drop = db.prepare('DELETE FROM auth_tokens WHERE address = ?')
  for (const row of rows) {
    const aad = aadOf(row.address, row.base_url)
    try {
      const token = decryptSecret(oldKek, row.encrypted_token, aad)
      update.run(encryptSecret(newKek, token, aad), row.address)
    } catch {
      drop.run(row.address)
    }
  }
}
