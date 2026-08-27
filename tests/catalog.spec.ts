import { describe, expect, it } from 'vitest'
import { defaultNativeDecimals, defaultNativeSymbol, inferNetworkScope, inferWalletType, mapCurrency, mapNetwork, mapToken } from '../electron/main/catalog/map'
import { bundleFromPreset, parseLookupPayload } from '../electron/main/catalog/lookup'
import { matchNetworkPreset } from '../shared/networkPresets'

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
      source: 'builtin',
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

describe('自定义网络原生币默认值', () => {
  it('按链类型给出精度和符号', () => {
    expect(defaultNativeDecimals('bitcoin')).toBe(8)
    expect(defaultNativeDecimals('web3')).toBe(18)
    expect(defaultNativeDecimals('tron')).toBe(6)
    expect(defaultNativeDecimals('solana')).toBe(9)
    expect(defaultNativeSymbol('web3', 'POL')).toBe('POL')
    expect(defaultNativeSymbol('solana', null)).toBe('SOL')
  })

  it('按名称 / chainId 匹配常见链主币', () => {
    expect(matchNetworkPreset('base')).toMatchObject({ chainId: '8453', coinEasy: 'ETH', supported: true })
    expect(matchNetworkPreset('8453')).toMatchObject({ networkName: 'Base', coinEasy: 'ETH' })
    expect(matchNetworkPreset('xoc')).toMatchObject({ chainId: '3721', coinEasy: 'XOC', supported: true })
    expect(matchNetworkPreset('xone')).toMatchObject({ coinEasy: 'XOC' })
    expect(matchNetworkPreset('sui')).toMatchObject({ supported: false, coinEasy: 'SUI' })
  })

  it('本地 Base 预设带主币 ETH 和热门 USDC/USDT', () => {
    const preset = matchNetworkPreset('base')
    expect(preset).toBeTruthy()
    const bundle = bundleFromPreset(preset!)
    expect(bundle.native?.symbol).toBe('ETH')
    expect(bundle.tokens.map((item) => item.symbol)).toEqual(['USDC', 'USDT'])
  })

  it('解析目录站 lookup 响应', () => {
    const result = parseLookupPayload({
      network: {
        id: '8453',
        networkName: 'Base',
        chainId: '8453',
        chainName: 'Mainnet',
        type: 'web3',
        coinEasy: 'ETH',
        coinId: 'ethereum',
        rpcUrl: 'https://mainnet.base.org',
      },
      native: {
        id: 'n1',
        symbol: 'ETH',
        decimals: 18,
        isToken: 'N',
        contractAddress: '0',
        tNetworkId: '8453',
      },
      tokens: [
        {
          id: 't1',
          symbol: 'USDC',
          decimals: 6,
          isToken: 'Y',
          contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          tNetworkId: '8453',
        },
      ],
    })
    expect(result?.network).toMatchObject({ networkName: 'Base', chainId: '8453', coinEasy: 'ETH' })
    expect(result?.native?.symbol).toBe('ETH')
    expect(result?.tokens).toEqual([
      expect.objectContaining({ symbol: 'USDC', isToken: true }),
    ])
  })
})
