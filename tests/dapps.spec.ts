import { describe, expect, it } from 'vitest'
import { DAPP_CATEGORIES, DAPP_ENTRIES, dappCategoryById, dappsInCategory } from '../shared/dapps'

describe('三方连接列表', () => {
  it('分类齐全', () => {
    expect(DAPP_CATEGORIES.map((item) => item.id)).toEqual(['hot', 'swap', 'stocks', 'betting', 'games', 'faucet'])
    expect(dappCategoryById('swap')?.id).toBe('swap')
  })

  it('站点都是 https，兑换里包含 PancakeSwap 与 Uniswap', () => {
    expect(DAPP_ENTRIES.every((item) => item.url.startsWith('https://'))).toBe(true)
    const swap = dappsInCategory('swap')
    expect(swap.some((item) => item.url.includes('pancakeswap.finance'))).toBe(true)
    expect(swap.some((item) => item.url.includes('app.uniswap.org'))).toBe(true)
  })
})
