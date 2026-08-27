import { describe, expect, it } from 'vitest'
import { AUTH_EXPIRED_CODES, BackendError, buildQuery, isAuthExpired, joinUrl, unwrap } from '../electron/main/backend/http'
import { extractList } from '../electron/main/backend/list'
import { buildAuthMessage } from '../electron/main/backend/auth'
import { toChecksumAddress } from '../electron/main/derive/evm'

describe('HTTP 解包', () => {
  it('joinUrl 去掉多余斜杠，绝对地址原样返回', () => {
    expect(joinUrl('https://api.one-wallet.org/', '/api/network/list')).toBe(
      'https://api.one-wallet.org/api/network/list',
    )
    expect(joinUrl('https://api.example.com', 'https://rpc.example.com')).toBe('https://rpc.example.com')
  })

  it('buildQuery 忽略空值', () => {
    expect(buildQuery({ a: '1', b: '', c: undefined, d: 2 })).toBe('?a=1&d=2')
  })

  it('success 包装解出 data，失败抛 BackendError', () => {
    expect(unwrap(200, { success: true, data: { id: 1 }, msg: 'ok' })).toEqual({ id: 1 })
    expect(() => unwrap(200, { success: false, data: null, msg: '失败' })).toThrow(BackendError)
  })

  it('没有 success 字段时原样返回，兼容目录列表', () => {
    expect(unwrap(200, [{ id: '1' }])).toEqual([{ id: '1' }])
  })

  it('HTTP 401 与业务码 101/102 视为 token 过期', () => {
    expect(isAuthExpired(401, { msg: 'Unauthorized' })).toBe(true)
    expect(isAuthExpired(200, { code: 101, msg: 'Token expired' })).toBe(true)
    expect(isAuthExpired(200, { code: 102, message: 'Unauthorized' })).toBe(true)
    expect(AUTH_EXPIRED_CODES).toEqual([101, 102])
    expect(() => unwrap(401, { code: 101, msg: 'Token expired' })).toThrow(BackendError)
    try {
      unwrap(401, { code: 101, msg: 'Token expired' })
    } catch (err) {
      expect(err).toMatchObject({ code: 'AUTH_EXPIRED' })
    }
  })
})

describe('列表解包', () => {
  it('支持数组、data、list 三种信封', () => {
    expect(extractList([1, 2])).toEqual([1, 2])
    expect(extractList({ data: [1] })).toEqual([1])
    expect(extractList({ list: [2] })).toEqual([2])
    expect(extractList({ records: [] })).toEqual([])
    expect(extractList({ items: [3] })).toEqual([3])
  })
})

describe('鉴权消息', () => {
  it('payload 顺序固定为 address → time，输出 0x keccak hex', () => {
    const address = toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')
    const message = buildAuthMessage(address, 1_700_000_000_000)
    expect(message.startsWith('0x')).toBe(true)
    expect(message).toHaveLength(66)
    expect(buildAuthMessage(address, 1_700_000_000_000)).toBe(message)
    expect(buildAuthMessage(address, 1_700_000_000_001)).not.toBe(message)
  })
})
