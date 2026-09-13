import { describe, expect, it } from 'vitest'
import { DAPP_HOT_CATEGORY_ID, dappCategoryById, dappsInCategory, defaultDappCategoryId } from '../shared/dapps'
import { assembleDappCatalog, parseDapp, parseDappCategory, parseHttpsUrl } from '../electron/main/dapp/codec'
import { DAPP_PROVIDER_INJECT } from '../electron/dapp-inject'
import { DAPP_PROVIDER_INFO } from '../electron/dapp-provider-info'

describe('三方连接目录解包', () => {
  it('只接受 https 链接', () => {
    expect(parseHttpsUrl('https://app.uniswap.org/')).toBe('https://app.uniswap.org/')
    expect(parseHttpsUrl('http://evil.example/')).toBeNull()
    expect(parseHttpsUrl('javascript:alert(1)')).toBeNull()
    expect(parseHttpsUrl('')).toBeNull()
  })

  it('兼容目录站分类字段拼写', () => {
    const row = parseDappCategory({
      id: 3,
      catetoryName: '兑换',
      catetoryIcon: 'https://cdn.example/dex.png',
      sort: '2',
    })
    expect(row).toEqual({
      id: '3',
      name: '兑换',
      icon: 'https://cdn.example/dex.png',
      sort: 2,
      virtual: false,
    })
  })

  it('丢掉没有 https 地址的站点', () => {
    expect(
      parseDapp({
        id: '1',
        dappName: 'Bad',
        dappUrl: 'http://example.com',
        categoryId: '3',
      }),
    ).toBeNull()
    const row = parseDapp({
      id: '2',
      dappName: 'PancakeSwap',
      dappUrl: 'https://pancakeswap.finance/swap',
      categoryId: '3',
      isHot: '1',
      isTop: 'Y',
      remark: 'BSC 兑换',
    })
    expect(row?.url).toBe('https://pancakeswap.finance/swap')
    expect(row?.isHot).toBe(true)
    expect(row?.isTop).toBe(true)
    expect(row?.remark).toBe('BSC 兑换')
  })

  it('有热门站点时在最前插入热门分类，并去掉写死列表', () => {
    const catalog = assembleDappCatalog(
      [{ id: '3', categoryName: '兑换', sort: 1 }],
      [
        { id: '2', dappName: 'PancakeSwap', dappUrl: 'https://pancakeswap.finance/swap', categoryId: '3', isHot: 1 },
        { id: '9', dappName: 'Skip', dappUrl: 'http://localhost', categoryId: '3' },
      ],
    )
    expect(catalog.categories.map((item) => item.id)).toEqual([DAPP_HOT_CATEGORY_ID, '3'])
    expect(catalog.dapps).toHaveLength(1)
    expect(dappCategoryById(catalog, DAPP_HOT_CATEGORY_ID)?.virtual).toBe(true)
    expect(defaultDappCategoryId(catalog)).toBe(DAPP_HOT_CATEGORY_ID)
    expect(dappsInCategory(catalog, DAPP_HOT_CATEGORY_ID).map((item) => item.name)).toEqual(['PancakeSwap'])
    expect(dappsInCategory(catalog, '3')).toHaveLength(1)
  })
})

describe('EIP-6963 钱包图标', () => {
  it('注入蜜蜂 logo，而不是字母 B', () => {
    expect(DAPP_PROVIDER_INFO.name).toBe('Bee Wallet Lab')
    expect(DAPP_PROVIDER_INFO.rdns).toBe('lab.bee-wallet')
    expect(DAPP_PROVIDER_INFO.icon.startsWith('data:image/png;base64,')).toBe(true)
    expect(DAPP_PROVIDER_INJECT).toContain('data:image/png;base64,')
    expect(DAPP_PROVIDER_INJECT).not.toContain('%3EB')
  })
})
