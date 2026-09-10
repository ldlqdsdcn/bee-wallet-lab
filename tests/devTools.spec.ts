import { describe, expect, it } from 'vitest'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { sha256 } from '@noble/hashes/sha2'
import { keccak_256 } from '@noble/hashes/sha3'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import { convertBytes, formatJson, hashBytes } from '../electron/main/devTools/codec'

describe('开发工具 IPC', () => {
  it('JSON / Hex / Hash 通道已加入白名单', () => {
    expect(IPC.devToolsJson).toBe('devTools:json')
    expect(IPC.devToolsConvert).toBe('devTools:convert')
    expect(IPC.devToolsHash).toBe('devTools:hash')
    expect(IPC_CHANNELS).toContain(IPC.devToolsJson)
    expect(IPC_CHANNELS).toContain(IPC.devToolsConvert)
    expect(IPC_CHANNELS).toContain(IPC.devToolsHash)
  })
})

describe('JSON 格式化', () => {
  it('格式化并压缩对象', () => {
    const result = formatJson('{"b":1,"a":[true,null]}')
    expect(result.kind).toBe('object')
    expect(result.minified).toBe('{"b":1,"a":[true,null]}')
    expect(result.pretty).toContain('\n')
    expect(result.pretty).toContain('"b": 1')
  })

  it('拒绝非法 JSON', () => {
    expect(() => formatJson('{')).toThrow(/JSON 不合法/)
  })
})

describe('Hex 转换', () => {
  it('UTF-8 与 Hex 可往返', () => {
    const encoded = convertBytes('utf8-to-hex', 'hello')
    expect(encoded.output).toBe('0x68656c6c6f')
    expect(encoded.bytes).toBe(5)
    const decoded = convertBytes('hex-to-utf8', encoded.output)
    expect(decoded.output).toBe('hello')
  })

  it('Hex 与 Base64 可往返', () => {
    const toB64 = convertBytes('hex-to-base64', '0x68656c6c6f')
    expect(toB64.output).toBe('aGVsbG8=')
    const back = convertBytes('base64-to-hex', toB64.output)
    expect(back.output).toBe('0x68656c6c6f')
  })

  it('拒绝非法十六进制', () => {
    expect(() => convertBytes('hex-to-utf8', '0xzz')).toThrow(/十六进制/)
  })
})

describe('Hash', () => {
  it('计算 SHA-256 与 Keccak-256', () => {
    const result = hashBytes('hello', 'utf8')
    const bytes = utf8ToBytes('hello')
    expect(result.bytes).toBe(5)
    expect(result.hashes.find((item) => item.algo === 'sha256')?.hex).toBe(`0x${bytesToHex(sha256(bytes))}`)
    expect(result.hashes.find((item) => item.algo === 'keccak256')?.hex).toBe(`0x${bytesToHex(keccak_256(bytes))}`)
    expect(result.hashes.map((item) => item.algo)).toEqual([
      'sha256',
      'keccak256',
      'sha512',
      'sha3-256',
      'ripemd160',
      'blake2b',
    ])
  })

  it('可按 Hex 输入计算', () => {
    const fromText = hashBytes('hello', 'utf8')
    const fromHex = hashBytes('0x68656c6c6f', 'hex')
    expect(fromHex.hashes).toEqual(fromText.hashes)
  })
})
