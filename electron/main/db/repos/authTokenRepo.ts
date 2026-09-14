/**
 * auth_tokens 仓储：按「鉴权地址 + baseUrl」维度缓存 JWT。
 * 用设备级封装，不跟主密码绑定，启动时就能读取和续期。
 */
import { decryptDeviceSecret, encryptDeviceSecret } from '../../backend/deviceWrap'
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
      token: decryptDeviceSecret(row.encrypted_token, aadOf(row.address, row.base_url)),
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    }
  } catch {
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
  const encrypted = encryptDeviceSecret(input.token, aadOf(input.address, input.baseUrl))
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

