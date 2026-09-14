/**
 * 鉴权：用本机目录站专用 EVM 私钥签名换 JWT（见 catalogAuth.ts）。
 *
 * 签名口径必须与服务端 pinko_node/api/AuthTokenApi.js 完全一致：
 *   1. payload = {"address": <EIP-55 地址>, "time": <毫秒时间戳>}，key 顺序固定 address → time
 *   2. hash = keccak256(utf8(JSON.stringify(payload)))，取 0x 开头的 hex 字符串
 *   3. 对「该 hex 字符串文本」做 EIP-191 personal_sign（不是对 32 字节摘要做原始签名）
 *   4. POST /auth/authenticate { address, time, sigMsg } → data 即 JWT
 * 服务端用 recovered === address 严格比较，所以地址必须是 checksum 形态。
 *
 * 生命周期：
 *   专用私钥第一次启动时生成，不跟主密码绑定；
 *   token 有效期约 30 天，按 address + baseUrl 用设备密钥封装缓存；
 *   启动时若没有或已过期则重签一次；
 *   并发请求合并去重，绝不同时发多次 authenticate。
 */
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import {
  loadAuthToken,
  parseJwtExpiry,
  removeAuthToken,
  saveAuthToken,
  type CachedAuthToken,
} from '../db/repos/authTokenRepo'
import { toChecksumAddress } from '../derive/evm'
import { getBaseUrl } from './config'
import { BackendError, DEFAULT_TIMEOUT_MS, joinUrl, rawFetch, unwrap } from './http'

export const AUTHENTICATE_PATH = '/auth/authenticate'

/** 提前 60 秒视为过期，避免请求在途中失效 */
export const TOKEN_EXPIRY_SKEW_MS = 60_000

export interface AuthIdentity {
  /** EIP-55 checksum 地址 */
  address: string
  /** 用鉴权账户私钥做 EIP-191 personal_sign，私钥不出这个闭包 */
  sign: (message: string) => string
}

/** 由任务 4 的钱包层注册；未注册或未解锁时抛错 */
export type AuthIdentityProvider = () => AuthIdentity

let identityProvider: AuthIdentityProvider | null = null
let memoryToken: CachedAuthToken | null = null
let inflight: Promise<string> | null = null

export function setAuthIdentityProvider(provider: AuthIdentityProvider | null): void {
  identityProvider = provider
}

export function resolveIdentity(): AuthIdentity {
  if (!identityProvider) {
    throw new BackendError('NO_AUTH_WALLET', '还没有目录站鉴权私钥')
  }
  const identity = identityProvider()
  return { ...identity, address: toChecksumAddress(identity.address) }
}

/** 拿不到身份时返回 null，用于展示状态而不是报错 */
export function peekAuthAddress(): string | null {
  try {
    return resolveIdentity().address
  } catch {
    return memoryToken?.address ?? null
  }
}

/** 待签名消息：keccak256(utf8(JSON)) 的 hex 字符串 */
export function buildAuthMessage(address: string, time: number): string {
  const payload = `{"address":"${address}","time":${time}}`
  return `0x${bytesToHex(keccak_256(utf8ToBytes(payload)))}`
}

export interface AuthRequestBody {
  address: string
  time: number
  sigMsg: string
}

export function buildAuthRequest(identity: AuthIdentity, now = Date.now()): AuthRequestBody {
  const address = toChecksumAddress(identity.address)
  const time = now
  return { address, time, sigMsg: identity.sign(buildAuthMessage(address, time)) }
}

export function isTokenUsable(token: CachedAuthToken | null, now = Date.now()): boolean {
  if (!token) return false
  return token.expiresAt - TOKEN_EXPIRY_SKEW_MS > now
}

/** 当前内存中的 token（不触发网络请求），baseUrl 变了即视为无效 */
export function currentToken(): CachedAuthToken | null {
  if (!memoryToken) return null
  if (memoryToken.baseUrl !== getBaseUrl()) return null
  return isTokenUsable(memoryToken) ? memoryToken : null
}

/** 把落盘的 token 读进内存，不需要解锁 */
export function hydrateAuthToken(): CachedAuthToken | null {
  const address = peekAuthAddress()
  if (!address) return null
  const cached = loadAuthToken(address, getBaseUrl())
  if (cached && isTokenUsable(cached)) {
    memoryToken = cached
    return cached
  }
  return null
}

async function requestToken(): Promise<string> {
  const baseUrl = getBaseUrl()
  const identity = resolveIdentity()
  const body = buildAuthRequest(identity)
  const { status, body: payload } = await rawFetch(
    joinUrl(baseUrl, AUTHENTICATE_PATH),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(body),
    },
    DEFAULT_TIMEOUT_MS,
  )

  // authenticate 自身的 401 是「签名验证失败」，不是 token 过期，不要触发重试
  if (status === 401) {
    throw new BackendError(
      'AUTH_REJECTED',
      '后端拒绝了鉴权签名，请检查本机时间与后端地址是否正确',
      status,
      payload,
    )
  }
  const token = unwrap<unknown>(status, payload)
  if (typeof token !== 'string' || !token) {
    throw new BackendError('AUTH_REJECTED', '后端未返回有效的 JWT', status, payload)
  }

  memoryToken = saveAuthToken({
    address: identity.address,
    baseUrl,
    token,
    expiresAt: parseJwtExpiry(token),
  })
  return token
}

/**
 * 取 token。缓存优先，必要时换新；并发调用共享同一个在途请求。
 */
export async function getToken(options: { force?: boolean } = {}): Promise<string> {
  if (!options.force) {
    const cached = currentToken() ?? hydrateAuthToken()
    if (cached) return cached.token
  }
  if (inflight) return inflight

  inflight = requestToken().finally(() => {
    inflight = null
  })
  return inflight
}

/** token 被后端判定失效时调用，连带清掉落盘缓存 */
export function invalidateToken(): void {
  const address = memoryToken?.address ?? peekAuthAddress()
  memoryToken = null
  if (!address) return
  try {
    removeAuthToken(address)
  } catch {
    // 数据库不可用不影响后续重新换取
  }
}

/** 切换 baseUrl / 更换鉴权钱包 / 退出时清空内存状态 */
export function resetAuthState(): void {
  memoryToken = null
  inflight = null
}
