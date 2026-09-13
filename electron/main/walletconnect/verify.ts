import { net } from 'electron'
import type { IVerify, Verify } from '@walletconnect/types'

export const VERIFY_TIMEOUT_MS = 8_000
const VERIFY_HOSTS = new Set(['verify.walletconnect.org', 'verify.walletconnect.com'])
let fetchInstalled = false
const guarded = new WeakSet<IVerify>()

/** SDK 内部直接调用全局 fetch；仅身份校验域名交给已配置代理的 Electron 网络栈。 */
export function createVerifyFetch(direct: typeof fetch, proxied: typeof fetch): typeof fetch {
  return (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let useProxy = false
    try {
      const url = new URL(raw)
      useProxy = url.protocol === 'https:' && VERIFY_HOSTS.has(url.hostname)
    } catch { /* 非 URL 输入沿用原 fetch 的错误处理 */ }
    return useProxy ? proxied(input, init) : direct(input, init)
  }
}

export function installVerifyFetch(): void {
  if (fetchInstalled) return
  const direct = globalThis.fetch.bind(globalThis)
  globalThis.fetch = createVerifyFetch(direct, (input, init) =>
    net.fetch(input instanceof URL ? input.href : input, init),
  )
  fetchInstalled = true
}

/** SDK 的公钥获取失败可能留下永不结束的 fetchPromise，阻塞 session_request。 */
export function guardVerifyResolution(verify: IVerify): void {
  if (guarded.has(verify)) return
  guarded.add(verify)
  const resolve = verify.resolve.bind(verify)
  verify.resolve = async (params) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        resolve(params),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('WalletConnect Verify timeout')), VERIFY_TIMEOUT_MS)
        }),
      ])
    } catch (error) {
      console.warn('[walletconnect] 网站身份校验不可用，将标记为未验证',
        error instanceof Error ? error.message : 'Verify failed')
      // 保留 SDK 的 UNKNOWN 降级路径，不伪造 VALID 或吞掉已返回的风险结果。
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

export function verificationStatus(context?: Verify.Context): 'VALID' | 'UNKNOWN' | 'INVALID' | 'SCAM' {
  if (context?.verified?.isScam) return 'SCAM'
  return context?.verified?.validation ?? 'UNKNOWN'
}
