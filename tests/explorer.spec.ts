import { describe, expect, it } from 'vitest'
import type { NetworkRecord } from '../shared/types'
import { addressExplorerUrl, explorerTabTitle } from '../src/lib/explorer'

function network(partial: Partial<NetworkRecord> & Pick<NetworkRecord, 'walletType' | 'chainId'>): NetworkRecord {
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
    networkScope: 'mainnet',
    syncedAt: 0,
    ...partial,
  }
}

describe('区块链浏览器地址', () => {
  it('EVM 按 chainId 拼 etherscan / arbiscan / bscscan', () => {
    expect(addressExplorerUrl(network({ walletType: 'web3', chainId: '1' }), '0xabc')).toBe(
      'https://etherscan.io/address/0xabc',
    )
    expect(addressExplorerUrl(network({ walletType: 'web3', chainId: '42161' }), '0xabc')).toBe(
      'https://arbiscan.io/address/0xabc',
    )
    expect(addressExplorerUrl(network({ walletType: 'web3', chainId: '56' }), '0xabc')).toBe(
      'https://bscscan.com/address/0xabc',
    )
  })

  it('Bitcoin / TRON 走 mempool 与 tronscan', () => {
    expect(
      addressExplorerUrl(network({ walletType: 'bitcoin', chainId: 'Mainnet', networkScope: 'mainnet' }), 'bc1qxx'),
    ).toBe('https://mempool.space/address/bc1qxx')
    expect(
      addressExplorerUrl(network({ walletType: 'bitcoin', chainId: 'Testnet', networkScope: 'testnet' }), 'tb1qxx'),
    ).toBe('https://mempool.space/testnet/address/tb1qxx')
    expect(addressExplorerUrl(network({ walletType: 'tron', chainId: '195' }), 'Txyz')).toBe(
      'https://tronscan.org/#/address/Txyz',
    )
  })

  it('未知 EVM 链回落到目录 browser 字段', () => {
    expect(
      addressExplorerUrl(
        network({ walletType: 'web3', chainId: '999', browser: 'https://scan.example.com/' }),
        '0xabc',
      ),
    ).toBe('https://scan.example.com/address/0xabc')
  })

  it('标签标题取 hostname', () => {
    expect(explorerTabTitle('https://etherscan.io/address/0xabc')).toBe('etherscan.io')
  })
})
