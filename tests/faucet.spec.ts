import { describe, expect, it } from 'vitest'
import { builtinFaucetsFor, normalizeFaucetUrl } from '../electron/main/catalog/faucetPresets'
import type { NetworkRecord } from '../shared/types'

function network(partial: Partial<NetworkRecord> & Pick<NetworkRecord, 'walletType' | 'chainId' | 'networkScope'>): NetworkRecord {
  return {
    id: '1',
    networkId: 'x',
    networkName: 'X',
    chainName: 'X',
    chainType: null,
    coinId: null,
    coinEasy: null,
    rpcUrl: null,
    browser: null,
    icon: null,
    webAddress: null,
    supportGasTime: null,
    remark: null,
    source: 'builtin',
    syncedAt: 0,
    ...partial,
  }
}

describe('水龙头地址', () => {
  it('去掉末尾斜杠，拒绝非 http(s)', () => {
    expect(normalizeFaucetUrl('https://faucet.solana.com/')).toBe('https://faucet.solana.com')
    expect(() => normalizeFaucetUrl('javascript:alert(1)')).toThrow('只支持 http 或 https 水龙头')
    expect(() => normalizeFaucetUrl('not-a-url')).toThrow('水龙头地址无效')
  })
})

describe('内置水龙头', () => {
  it('主网没有水龙头', () => {
    expect(builtinFaucetsFor(network({ walletType: 'web3', chainId: '1', networkScope: 'mainnet' }))).toEqual([])
    expect(builtinFaucetsFor(network({ walletType: 'bitcoin', chainId: 'Mainnet', networkScope: 'mainnet' }))).toEqual(
      [],
    )
  })

  it('Sepolia / Nile / Solana Devnet / BTC Testnet 有内置项', () => {
    expect(builtinFaucetsFor(network({ walletType: 'web3', chainId: '11155111', networkScope: 'testnet' })).length).toBeGreaterThan(
      0,
    )
    expect(builtinFaucetsFor(network({ walletType: 'tron', chainId: '1029', networkScope: 'testnet' })).some((item) =>
      item.url.includes('nileex'),
    )).toBe(true)
    expect(builtinFaucetsFor(network({ walletType: 'solana', chainId: 'devnet', networkScope: 'testnet' })).some((item) =>
      item.url.includes('faucet.solana.com'),
    )).toBe(true)
    expect(builtinFaucetsFor(network({ walletType: 'bitcoin', chainId: 'Testnet', networkScope: 'testnet' })).length).toBeGreaterThan(
      0,
    )
  })

  it('未知测试网先空着，留给用户手动加', () => {
    expect(builtinFaucetsFor(network({ walletType: 'web3', chainId: '999999', networkScope: 'testnet' }))).toEqual([])
  })
})
