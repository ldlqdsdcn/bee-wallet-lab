import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type { AssetEntry, PortfolioSnapshot, TokenBalanceRow } from '../../../shared/types'
import { handle, broadcast, requireString } from './registry'
import { getAccountPortfolio, getPortfolioSnapshot, getTokenBalances } from '../portfolio/service'
import { saveSettings } from '../db/repos/metaRepo'

export function registerPortfolioIpc(): void {
  handle<{ networkPk?: string }, PortfolioSnapshot>(IPC.portfolioSnapshot, (arg) =>
    getPortfolioSnapshot(arg?.networkPk),
  )

  handle<{ networkPk?: string }, PortfolioSnapshot>(IPC.portfolioRefresh, async (arg) => {
    if (arg?.networkPk) saveSettings({ defaultNetworkPk: arg.networkPk })
    const snapshot = await getPortfolioSnapshot(arg?.networkPk)
    broadcast(IPC_EVENT.balanceUpdated, snapshot)
    return snapshot
  })

  handle<{ accountId: string; networkPk: string }, AssetEntry[]>(IPC.portfolioAccount, (arg) =>
    getAccountPortfolio(requireString(arg?.accountId, 'accountId'), requireString(arg?.networkPk, 'networkPk')),
  )

  handle<{ networkPk: string; tokenPk: string; addresses: string[] }, TokenBalanceRow[]>(
    IPC.portfolioTokenBalances,
    (arg) =>
      getTokenBalances({
        networkPk: requireString(arg?.networkPk, 'networkPk'),
        tokenPk: requireString(arg?.tokenPk, 'tokenPk'),
        addresses: Array.isArray(arg?.addresses) ? arg.addresses.map(String) : [],
      }),
  )
}
