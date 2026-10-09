import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import { navigationGroups } from '../shared/navigation'
import { totalCurrencyOf } from '../electron/main/portfolio/total'
import type { AssetEntry } from '../shared/types'

function entry(currencyBalance: string | null): AssetEntry {
  return {
    key: 'k',
    tokenPk: 't',
    networkPk: 'n',
    symbol: 'ETH',
    name: 'Ether',
    decimals: 18,
    iconUrl: null,
    isToken: false,
    contractAddress: null,
    addressType: null,
    address: '0x1',
    accountId: null,
    balance: '1',
    unconfirmed: null,
    currencyBalance,
    updatedAt: 1,
    stale: false,
    error: null,
  }
}

describe('分层钱包资产', () => {
  it('导航包含分层钱包资产', () => {
    const group = navigationGroups.find((item) => item.id === 'hd')
    expect(group?.items.map((item) => item.to)).toEqual(['/hd-assets', '/hd'])
    expect(IPC.portfolioAddresses).toBe('portfolio:addresses')
    expect(IPC_CHANNELS).toContain(IPC.portfolioAddresses)
  })

  it('法币合计只加有行情的代币', () => {
    expect(totalCurrencyOf([])).toBeNull()
    expect(totalCurrencyOf([entry(null), entry('1.20'), entry('3.80')])).toBe('5.00')
    expect(totalCurrencyOf([entry('not-a-number')])).toBeNull()
  })
})
