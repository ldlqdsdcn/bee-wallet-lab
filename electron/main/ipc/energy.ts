import { IPC } from '../../../shared/ipc'
import type { EnergyResources } from '../../../shared/types'
import { handle, requireString } from './registry'
import { loadEnergyResources } from '../energy/service'

export function registerEnergyIpc(): void {
  handle<{ accountId: string; networkPk: string }, EnergyResources>(IPC.energyResources, (arg) =>
    loadEnergyResources(requireString(arg?.accountId, 'accountId'), requireString(arg?.networkPk, 'networkPk')),
  )
}
