import { describe, expect, it } from 'vitest'
import {
  chainIdDecimal,
  describeSessionProposal,
  hexToUtf8,
  parseWalletConnectUri,
  sessionSummary,
  toCaipAccount,
} from '../electron/main/walletconnect/codec'

describe('WalletConnect 解析', () => {
  it('接受 wc: 链接，也从网页 URL 里抽出 uri', () => {
    const uri = 'wc:abc123@2?relay-protocol=irn&symKey=deadbeef'
    expect(parseWalletConnectUri(uri)).toBe(uri)
    expect(parseWalletConnectUri(`https://example.com/wc?uri=${encodeURIComponent(uri)}`)).toBe(uri)
    expect(parseWalletConnectUri(`请使用此链接连接 ${uri} 谢谢`)).toBe(uri)
    expect(parseWalletConnectUri(`https://walletconnect.com/wc?uri=${encodeURIComponent(uri)}`)).toBe(uri)
    expect(parseWalletConnectUri(encodeURIComponent(uri))).toBe(uri)
    expect(parseWalletConnectUri(`${uri}&methods=wc_sessionPropose,wc_sessionAuthenticate`)).toBe(
      `${uri}&methods=wc_sessionPropose,wc_sessionAuthenticate`,
    )
    expect(() => parseWalletConnectUri('https://app.uniswap.org')).toThrow('不是 WalletConnect')
    expect(() => parseWalletConnectUri('')).toThrow('请粘贴')
  })

  it('chainId 转成十进制和 CAIP-10', () => {
    expect(chainIdDecimal('0x1')).toBe('1')
    expect(chainIdDecimal('eip155:56')).toBe('56')
    expect(toCaipAccount('0x2105', '0xabc')).toBe('eip155:8453:0xabc')
  })

  it('把 hex 消息还原成文本', () => {
    expect(hexToUtf8('0x68656c6c6f')).toBe('hello')
  })

  it('连接请求详情用人话列出链，不摊 JSON', () => {
    const text = describeSessionProposal({
      url: 'https://pancakeswap.finance',
      requiredNamespaces: {},
      optionalNamespaces: { eip155: { chains: ['eip155:56', 'eip155:1', 'eip155:8453'] } },
    })
    expect(text).toContain('BSC')
    expect(text).toContain('Ethereum')
    expect(text).not.toContain('optionalNamespaces')
  })

  it('会话摘要用 metadata', () => {
    const row = sessionSummary({
      topic: 'topic-1',
      expiry: 10,
      peer: { metadata: { name: 'PancakeSwap', url: 'https://pancakeswap.finance', icons: ['https://x/i.png'] } },
      namespaces: { eip155: { chains: ['eip155:56'], accounts: ['eip155:56:0x1'] } },
    })
    expect(row).toMatchObject({
      topic: 'topic-1',
      name: 'PancakeSwap',
      url: 'https://pancakeswap.finance',
      chains: ['eip155:56'],
    })
  })
})
