import { create } from 'zustand'
import { IPC_EVENT } from '@shared/ipc'
import type { WalletSummary } from '@shared/types'
import { on, walletApi } from '../lib/bridge'

interface WalletStoreState {
  current: WalletSummary | null
  currentId: string | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  select: (id: string) => Promise<void>
}

export const useWalletStore = create<WalletStoreState>((set, get) => ({
  current: null,
  currentId: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const current = await walletApi.current()
      set({ current, currentId: current?.id ?? null, loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  select: async (id) => {
    if (id === get().currentId) return
    set({ error: null })
    try {
      await walletApi.setDefault(id)
      await get().load()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },
}))

/** 钱包增删改 / 切换当前后刷新侧栏与资产页。 */
export function subscribeWalletEvents(): () => void {
  return on(IPC_EVENT.walletsChanged, () => {
    void useWalletStore.getState().load()
  })
}
