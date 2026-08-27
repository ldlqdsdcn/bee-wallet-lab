import { describe, expect, it } from 'vitest'
import { inferNetworkScope, inferWalletType, mapCurrency, mapNetwork, mapToken } from '../electron/main/catalog/map'

describe('目录映射', () => {
  it('网络 type 映射为 bitcoin / web3 / tron / solana', () => {
    expect(inferWalletType('bitcoin')).toBe('bitcoin')
    expect(inferWalletType('tron')).toBe('tron')
    expect(inferWalletType('web3')).toBe('web3')
    expect(inferWalletType('solana')).toBe('solana')
  })

  it('chainId / chainName 含 test 时判定测试网', () => {
    expect(inferNetworkScope('Mainnet', '比特币主网络')).toBe('mainnet')
    expect(inferNetworkScope('11155111', 'Sepolia')).toBe('testnet')
    expect(inferNetworkScope('1029', 'Nile')).toBe('testnet')
  })

  it('mapNetwork 产出本地 NetworkRecord', () => {
    const record = mapNetwork(
      {
        id: '1',
        networkId: 'ethereum',
        networkName: 'Ethereum',
        chainId: '1',
        chainName: '以太坊主网',
        type: 'web3',
        coinEasy: 'ETH',
        rpcUrl: '/proxy/infura/1',
      },
      123,
    )
    expect(record).toMatchObject({
      id: '1',
      walletType: 'web3',
      networkScope: 'mainnet',
      coinEasy: 'ETH',
      syncedAt: 123,
    })
  })

  it('mapToken 把 isToken=N 且合约为 0 视为原生币', () => {
    const native = mapToken(
      {
        id: 't1',
        tokenId: 'ethereum',
        symbol: 'ETH',
        decimals: 18,
        isToken: 'N',
        contractAddress: '0',
        tNetworkId: '1',
      },
      1,
    )
    expect(native?.isToken).toBe(false)
    expect(native?.contractAddress).toBeNull()

    const erc20 = mapToken(
      {
        id: 't2',
        symbol: 'USDT',
        decimals: 6,
        isToken: 'Y',
        contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        tNetworkId: '1',
      },
      1,
    )
    expect(erc20?.isToken).toBe(true)
    expect(erc20?.contractAddress).toMatch(/^0x/)
  })

  it('mapCurrency 使用 currencyTypeCode，过滤未启用', () => {
    expect(mapCurrency({ id: '1', currencyTypeCode: 'usd', currencyTypeName: 'US Dollar', isEnable: 1 }, 1)).toMatchObject(
      { code: 'USD', name: 'US Dollar' },
    )
    expect(mapCurrency({ id: '2', currencyTypeCode: 'jpy', isEnable: 0 }, 1)).toBeNull()
  })
})

describe('内置目录 JSON', () => {
  it('能映射出网络、代币和法币', async () => {
    const { loadBuiltinCatalog } = await import('../electron/main/catalog/builtin')
    const catalog = loadBuiltinCatalog(1)
    expect(catalog.networks.length).toBeGreaterThanOrEqual(10)
    expect(catalog.tokens.length).toBeGreaterThanOrEqual(10)
    expect(catalog.currencies.map((item) => item.code)).toEqual(expect.arrayContaining(['USD', 'CNY']))
    expect(catalog.networks.some((item) => item.walletType === 'bitcoin')).toBe(true)
    expect(catalog.networks.some((item) => item.walletType === 'web3')).toBe(true)
    expect(catalog.networks.some((item) => item.walletType === 'tron')).toBe(true)
    expect(catalog.networks.some((item) => item.walletType === 'solana')).toBe(true)
    expect(catalog.tokens.some((item) => item.symbol === 'USDT' && item.isToken)).toBe(true)
  })
})
