import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFileKeyValueStorage } from '../electron/main/walletconnect/storage'
import {
  chainIdDecimal,
  describeSessionProposal,
  describeWcRequest,
  hexToUtf8,
  findWalletConnectDeepLink,
  pairingTopicFromUri,
  parseWalletConnectUri,
  pendingKind,
  sessionSummary,
  toCaipAccount,
  toHexChainId,
  walletCapabilities,
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
    expect(
      findWalletConnectDeepLink(['/usr/bin/electron', `https://walletconnect.com/wc?uri=${encodeURIComponent(uri)}`]),
    ).toBe(uri)
    expect(findWalletConnectDeepLink(['bee-wallet://wc?uri=' + encodeURIComponent(uri)])).toBe(uri)
    expect(findWalletConnectDeepLink(['/usr/bin/electron', '.'])).toBeNull()
    expect(() => parseWalletConnectUri('https://app.uniswap.org')).toThrow('不是 WalletConnect')
    expect(() => parseWalletConnectUri('')).toThrow('请粘贴')
    expect(pairingTopicFromUri(uri)).toBe('abc123')
  })

  it('chainId 转成十进制和 CAIP-10', () => {
    expect(chainIdDecimal('0x1')).toBe('1')
    expect(chainIdDecimal('eip155:56')).toBe('56')
    expect(toCaipAccount('0x2105', '0xabc')).toBe('eip155:8453:0xabc')
    expect(toHexChainId('eip155:56')).toBe('0x38')
  })

  it('wallet_sendCalls 当成发交易，其它请求用人话描述', () => {
    expect(pendingKind('wallet_sendCalls')).toBe('send')
    expect(describeWcRequest('wallet_sendCalls', [{ calls: [{ to: '0x1', data: '0x' }] }])).toContain('0x1')
  })

  it('wallet_getCapabilities 声明不支持批量代发，避免网站当方法不存在反复重试', () => {
    const result = walletCapabilities(['0xabc', ['0x1', 'eip155:56']], ['eip155:8453'])
    expect(result['0x1']?.atomic).toEqual({ status: 'unsupported' })
    expect(result['0x38']?.atomicBatch).toEqual({ supported: false })
    expect(walletCapabilities(['0xabc'], ['eip155:1'])['0x1']?.paymasterService).toEqual({ supported: false })
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

describe('WalletConnect 本地存储', () => {
  it('并行写入不会互相覆盖', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bee-wc-'))
    const storage = createFileKeyValueStorage(join(dir, 'walletconnect.json'))
    await Promise.all([
      storage.setItem('session', { topic: 'a' }),
      storage.setItem('keychain', { topic: 'secret' }),
      storage.setItem('history', [1, 2, 3]),
    ])
    expect(await storage.getItem('session')).toEqual({ topic: 'a' })
    expect(await storage.getItem('keychain')).toEqual({ topic: 'secret' })
    expect(await storage.getItem('history')).toEqual([1, 2, 3])
  })
})
