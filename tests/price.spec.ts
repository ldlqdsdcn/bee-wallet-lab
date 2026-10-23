import { describe, expect, it } from 'vitest'
import { coinGeckoId, fiatValue } from '../electron/main/price/coingecko'
import { gatePair, quoteFromUsdt } from '../electron/main/price/fallback'
import { pickMarketPrice } from '../electron/main/price/pick'
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
    source: 'builtin',
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
    source: 'builtin',
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

describe('行情交叉校验', () => {
  it('USDC / USDT 单价偏离 1 美元时按 1 美元计', () => {
    expect(pickMarketPrice('usd-coin', 'usd', 0.1001, 0.1)).toBe(1)
    expect(pickMarketPrice('usd-coin', 'USD', 0.999, 1.001)).toBe(0.999)
    expect(pickMarketPrice('tether', 'usd', undefined, undefined)).toBe(1)
  })

  it('ETH 单价差出 10 倍时用 Gate 现货', () => {
    expect(pickMarketPrice('ethereum', 'usd', 24643, 2445)).toBe(2445)
    expect(pickMarketPrice('ethereum', 'usd', 2445, 2460)).toBe(2445)
    expect(pickMarketPrice('solana', 'usd', 106.68, 105.9)).toBe(106.68)
  })
})
