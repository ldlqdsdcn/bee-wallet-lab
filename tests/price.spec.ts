import { describe, expect, it } from 'vitest'
import { coinGeckoId, fiatValue } from '../electron/main/price/coingecko'
import { gatePair, quoteFromUsdt } from '../electron/main/price/fallback'
import type { NetworkRecord, TokenRecord } from '../shared/types'

function token(partial: Partial<TokenRecord> & Pick<TokenRecord, 'symbol'>): TokenRecord {
  return {
    id: 't1',
    tokenId: null,
    name: partial.symbol,
    decimals: 18,
    contractAddress: null,
    tokenStandard: null,
    isToken: false,
    gasLimit: null,
    networkPk: '5',
    tokenIcon: null,
    blockchainExplorer: null,
    isDefaultSelected: true,
    syncedAt: 0,
    ...partial,
  }
}

function network(partial: Partial<NetworkRecord> = {}): NetworkRecord {
  return {
    id: '5',
    networkId: 'ethereum',
    networkName: 'Ethereum',
    chainId: '1',
    chainName: 'Mainnet',
    chainType: '1',
    walletType: 'web3',
    coinId: 'ethereum',
    coinEasy: 'ETH',
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

describe('CoinGecko 价格映射', () => {
  it('BTC / ETH 用官方 id', () => {
    expect(coinGeckoId(token({ symbol: 'BTC', tokenId: 'bitcoin' }))).toBe('bitcoin')
    expect(coinGeckoId(token({ symbol: 'ETH', tokenId: 'ethereum' }), network())).toBe('ethereum')
  })

  it('没有 tokenId 时按符号或网络 coinId 回退', () => {
    expect(coinGeckoId(token({ symbol: 'BTC' }))).toBe('bitcoin')
    expect(coinGeckoId(token({ symbol: 'ETH' }), network({ coinId: 'ethereum' }))).toBe('ethereum')
  })

  it('余额乘单价得到法币金额', () => {
    expect(fiatValue('1.5', 2000)).toBe('3000.00')
    expect(fiatValue('0.01', 100000)).toBe('1000.00')
    expect(fiatValue('bad', 1)).toBeNull()
  })
})

describe('备用行情', () => {
  it('主流币映射到 Gate USDT 交易对', () => {
    expect(gatePair('ethereum')).toBe('ETH_USDT')
    expect(gatePair('bitcoin')).toBe('BTC_USDT')
    expect(gatePair('tether')).toBeNull()
  })

  it('USDT 报价乘汇率得到 CNY', () => {
    expect(quoteFromUsdt(2500, 'usd', {})).toBe(2500)
    expect(quoteFromUsdt(2500, 'CNY', { cny: 7.2 })).toBe(18000)
    expect(quoteFromUsdt(2500, 'cny', {})).toBeNull()
  })
})
