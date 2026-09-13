import { afterEach, describe, expect, it, vi } from 'vitest'
import { Core } from '@walletconnect/core'
import type { IVerify } from '@walletconnect/types'
import {
  createVerifyFetch, guardVerifyResolution, verificationStatus, VERIFY_TIMEOUT_MS,
} from '../electron/main/walletconnect/verify'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('WalletConnect Verify 网络与超时', () => {
  it('仅官方 HTTPS 校验请求使用钱包网络栈，保留 Request 和取消信号', async () => {
    const direct = vi.fn(async () => new Response('direct'))
    const proxied = vi.fn(async () => new Response('proxy'))
    const fetch = createVerifyFetch(direct, proxied)
    const signal = new AbortController().signal
    await fetch('https://verify.walletconnect.org/v3/public-key', { signal })
    expect(proxied).toHaveBeenCalledWith('https://verify.walletconnect.org/v3/public-key', { signal })
    const request = new Request('https://verify.walletconnect.com/attestation/test')
    await fetch(request)
    expect(proxied).toHaveBeenLastCalledWith(request, undefined)
    await fetch(new URL('https://verify.walletconnect.org/v3/public-key'))
    await fetch('https://rpc.example.com')
    await fetch('https://verify.walletconnect.org.example.com/public-key')
    await fetch('http://verify.walletconnect.org/v3/public-key')
    expect(proxied).toHaveBeenCalledTimes(3)
    expect(direct).toHaveBeenCalledTimes(3)
  })

  it('真实 SDK 公钥网络失败后仍会挂起，超时保护使 SDK 能返回 UNKNOWN', async () => {
    vi.useFakeTimers()
    vi.stubEnv('IS_VITEST', 'false')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetch = vi.fn(async () => { throw new Error('verification network unavailable') })
    vi.stubGlobal('fetch', fetch)
    const storage = {
      getItem: async () => undefined, setItem: async () => {}, removeItem: async () => {},
      getKeys: async () => [], getEntries: async () => [],
    }
    // 只构造 SDK，不启动中继；所有网络请求都由上面的失败 stub 接管。
    const core = new Core({ projectId: 'verify-test', storage, logger: 'silent' })
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const attestationId = [
      encode({ alg: 'ES256', typ: 'JWT' }),
      encode({ id: 'test-message', origin: 'https://pancakeswap.finance', exp: Math.floor(Date.now() / 1000) + 300 }),
      Buffer.alloc(64).toString('base64url'),
    ].join('.')
    const params = { attestationId, encryptedId: 'test-message', hash: 'test-hash' }
    let settled = false
    void core.verify.resolve(params).then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalled()
    expect(settled).toBe(false)

    guardVerifyResolution(core.verify)
    // 即使 SDK 已缓存那个挂起的 Promise，后续请求也有确定的截止时间。
    const result = expect(core.verify.resolve(params)).rejects.toThrow('WalletConnect Verify timeout')
    await vi.advanceTimersByTimeAsync(VERIFY_TIMEOUT_MS)
    await result
    expect(verificationStatus()).toBe('UNKNOWN')
  })

  it('保留正常返回的校验和风险结果，结束后清理定时器', async () => {
    vi.useFakeTimers()
    const result = { origin: 'https://pancakeswap.finance', isScam: true }
    const verify = { resolve: vi.fn(async () => result) } as unknown as IVerify
    guardVerifyResolution(verify)
    const guardedResolve = verify.resolve
    guardVerifyResolution(verify)
    expect(verify.resolve).toBe(guardedResolve)
    expect(await verify.resolve({})).toBe(result)
    expect(vi.getTimerCount()).toBe(0)
    expect(verificationStatus({ verified: { ...result, validation: 'VALID', verifyUrl: '' } })).toBe('SCAM')
    expect(verificationStatus({ verified: { origin: '', validation: 'INVALID', verifyUrl: '' } })).toBe('INVALID')
  })

  it('校验失败直接交回 SDK 处理，不把失败结果当作验证通过', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const verify = { resolve: vi.fn(async () => { throw new Error('verify failed') }) } as unknown as IVerify
    guardVerifyResolution(verify)
    await expect(verify.resolve({})).rejects.toThrow('verify failed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
