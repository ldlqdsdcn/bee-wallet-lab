import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import { builtinRpcUrls, evmRpcCandidates } from '../electron/main/rpc/endpoints'
import { joinRpcPath, normalizeRpcUrl } from '../electron/main/rpc/url'
import type { NetworkRecord } from '../shared/types'

function network(chainId: string, rpcUrl: string | null = null): NetworkRecord {
  return {
    id: '5',
    networkId: 'ethereum',
    networkName: 'Ethereum',
    chainId,
    chainName: 'Mainnet',
    chainType: '1',
    walletType: 'web3',
    coinId: 'ethereum',
    coinEasy: 'ETH',
    rpcUrl,
    browser: null,
    icon: null,
    webAddress: null,
    supportGasTime: null,
    remark: null,
    networkScope: 'mainnet',
    source: 'builtin',
    syncedAt: 0,
  }
}

describe('RPC IPC', () => {
  it('包含节点请求头更新通道', () => {
    expect(IPC.rpcUpdate).toBe('rpc:update')
    expect(IPC_CHANNELS).toContain(IPC.rpcUpdate)
  })
})

describe('EVM RPC 候选', () => {
  it('以太坊主网在没有 Infura 时仍有公共节点', () => {
    const urls = evmRpcCandidates(network('1'))
    expect(urls.some((item) => item.includes('publicnode.com') || item.includes('1rpc.io'))).toBe(true)
  })

  it('BSC / Arbitrum 有公共 fallback', () => {
    expect(evmRpcCandidates(network('56')).length).toBeGreaterThan(0)
    expect(evmRpcCandidates(network('42161')).length).toBeGreaterThan(0)
  })

  it('Base / Xone 有公共节点', () => {
    expect(evmRpcCandidates(network('8453')).some((item) => item.includes('base.org'))).toBe(true)
    expect(evmRpcCandidates(network('3721')).some((item) => item.includes('xone.org'))).toBe(true)
  })
})

describe('RPC 地址规范化', () => {
  it('去掉末尾斜杠，保留路径与查询', () => {
    expect(normalizeRpcUrl('https://eth.example/v3/key/')).toBe('https://eth.example/v3/key')
  })

  it('拒绝 websocket', () => {
    expect(() => normalizeRpcUrl('wss://eth.example')).toThrow('只支持 http 或 https 节点')
  })

  it('拒绝无效地址', () => {
    expect(() => normalizeRpcUrl('not-a-url')).toThrow('RPC 地址无效')
  })

  it('拼接路径时处理多余斜杠', () => {
    expect(joinRpcPath('https://api.trongrid.io/', '/wallet/getnowblock')).toBe(
      'https://api.trongrid.io/wallet/getnowblock',
    )
  })
})

describe('内置节点', () => {
  it('Bitcoin / TRON 有默认可达的 API 根路径', () => {
    const btc = { ...network('0'), walletType: 'bitcoin' as const, networkName: 'Bitcoin' }
    const tron = { ...network('195'), walletType: 'tron' as const, networkName: 'TRON' }
    expect(builtinRpcUrls(btc).some((item) => item.includes('blockstream.info') || item.includes('mempool.space'))).toBe(
      true,
    )
    expect(builtinRpcUrls(tron).some((item) => item.includes('trongrid.io'))).toBe(true)
    const sol = { ...network('mainnet-beta'), walletType: 'solana' as const, networkName: 'Solana' }
    expect(builtinRpcUrls(sol).some((item) => item.includes('solana.com') || item.includes('publicnode.com'))).toBe(
      true,
    )
  })
})
