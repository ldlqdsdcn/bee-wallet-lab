import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type { PortfolioSnapshot } from '../../../shared/types'
import { handle, broadcast } from './registry'
import { getPortfolioSnapshot } from '../portfolio/service'
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
}
