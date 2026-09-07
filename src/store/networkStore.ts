import { create } from 'zustand'
import { IPC_EVENT } from '@shared/ipc'
import type { NetworkRecord } from '@shared/types'
import { catalogApi, on, settingsApi } from '../lib/bridge'
import { useVaultStore } from './vaultStore'

interface NetworkStoreState {
  networks: NetworkRecord[]
  currentPk: string
  pickerOpen: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  select: (id: string) => Promise<void>
  openPicker: () => void
  closePicker: () => void
}

export const useNetworkStore = create<NetworkStoreState>((set, get) => ({
  networks: [],
  currentPk: '',
  pickerOpen: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const [list, settings] = await Promise.all([catalogApi.networks(), settingsApi.get()])
      const preferred = settings.defaultNetworkPk
      const currentPk =
        (preferred && list.some((item) => item.id === preferred) ? preferred : null) || list[0]?.id || ''
      if (currentPk !== (preferred ?? '')) {
        const next = await settingsApi.update({ defaultNetworkPk: currentPk || null })
        useVaultStore.setState({ settings: next })
      }
      set({ networks: list, currentPk, loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  select: async (id) => {
    set({ pickerOpen: false })
    if (!id || id === get().currentPk) return
    try {
      const settings = await settingsApi.update({ defaultNetworkPk: id })
      useVaultStore.setState({ settings })
      set({ currentPk: id, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),
}))

export function currentNetworkOf(state: Pick<NetworkStoreState, 'networks' | 'currentPk'>): NetworkRecord | null {
  return state.networks.find((item) => item.id === state.currentPk) ?? null
}

/** 目录增删后刷新侧栏当前网络。 */
export function subscribeNetworkEvents(): () => void {
  return on(IPC_EVENT.catalogUpdated, () => {
    void useNetworkStore.getState().load()
  })
}
