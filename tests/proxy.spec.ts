import { describe, expect, it } from 'vitest'
import { displayProxyUrl, electronProxyRules, normalizeProxyUrl, parseProxyUrl, serializeProxy } from '../electron/main/net/proxy'
import { tunnelMessage } from '../electron/main/net/tunnel'

describe('代理地址解析', () => {
  it('空字符串表示直连', () => {
    expect(parseProxyUrl('')).toBeNull()
    expect(parseProxyUrl('   ')).toBeNull()
    expect(normalizeProxyUrl('')).toBe('')
  })

  it('host:port 默认补 http', () => {
    expect(parseProxyUrl('127.0.0.1:7890')).toMatchObject({
      href: 'http://127.0.0.1:7890',
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '7890',
    })
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
  })

  it('socks5 与 socks 都写成 socks5', () => {
    expect(parseProxyUrl('socks5://127.0.0.1:7891')?.href).toBe('socks5://127.0.0.1:7891')
    expect(parseProxyUrl('socks://127.0.0.1:1080')?.href).toBe('socks5://127.0.0.1:1080')
  })

  it('带账号的地址序列化后仍带账号', () => {
    const parsed = parseProxyUrl('http://user:p%40ss@127.0.0.1:7890')
    expect(parsed?.username).toBe('user')
    expect(parsed?.password).toBe('p@ss')
    expect(serializeProxy(parsed!)).toBe('http://user:p%40ss@127.0.0.1:7890')
  })

  it('拒绝不支持的协议', () => {
    expect(() => parseProxyUrl('ftp://127.0.0.1:21')).toThrow('仅支持')
    expect(() => parseProxyUrl('not a url ::')).toThrow('格式无效')
  })

  it('展示地址时隐藏密码', () => {
    expect(displayProxyUrl('http://user:secret@127.0.0.1:7890')).toBe('http://user:***@127.0.0.1:7890')
    expect(displayProxyUrl('socks5://127.0.0.1:7891')).toBe('socks5://127.0.0.1:7891')
  })

  it('Electron 规则把 http 代理同时用于 https CONNECT', () => {
    const parsed = parseProxyUrl('http://127.0.0.1:7892')
    expect(electronProxyRules(parsed!)).toBe('http=127.0.0.1:7892;https=127.0.0.1:7892')
    expect(electronProxyRules(parseProxyUrl('socks5://127.0.0.1:7891')!)).toBe('socks5://127.0.0.1:7891')
  })

  it('隧道失败说明端口空转', () => {
    expect(tunnelMessage('tls', '代理隧道超时')).toMatch(/没有转发 HTTPS/)
    expect(tunnelMessage('tcp', 'ECONNREFUSED')).toMatch(/无法连接代理端口/)
  })
})
