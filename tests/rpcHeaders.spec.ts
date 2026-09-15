import { describe, expect, it } from 'vitest'
import { matchRpcHeaders, parseRpcHeaders, serializeRpcHeaders } from '../shared/rpcHeaders'

describe('自定义 RPC 请求头', () => {
  it('解析 Name: value 与 curl -H', () => {
    expect(parseRpcHeaders('')).toEqual({})
    expect(
      parseRpcHeaders(`
        x-api-key: test-token
        -H 'Authorization: Bearer abc'
      `),
    ).toEqual({
      'x-api-key': 'test-token',
      Authorization: 'Bearer abc',
    })
  })

  it('解析 JSON 对象', () => {
    expect(parseRpcHeaders('{"x-api-key":"k"}')).toEqual({ 'x-api-key': 'k' })
  })

  it('拒绝空值和危险头', () => {
    expect(() => parseRpcHeaders('x-api-key:')).toThrow('不能为空')
    expect(() => parseRpcHeaders('Host: evil.test')).toThrow('不允许')
    expect(() => parseRpcHeaders('not-a-header')).toThrow('格式无效')
  })

  it('按最长 URL 前缀匹配', () => {
    const headers = matchRpcHeaders('https://rpc.example/v1/eth', [
      { url: 'https://rpc.example', headers: { 'x-api-key': 'short' } },
      { url: 'https://rpc.example/v1', headers: { 'x-api-key': 'long' } },
    ])
    expect(headers).toEqual({ 'x-api-key': 'long' })
  })

  it('往返序列化', () => {
    const headers = { 'x-api-key': 'k', Accept: 'application/json' }
    expect(parseRpcHeaders(serializeRpcHeaders(headers))).toEqual(headers)
  })
})
