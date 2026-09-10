import { create } from 'zustand'
import type { AppSettings, VaultStatus } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { normalizeLocale } from '@shared/locale'
import { translate } from '@shared/i18n'
import { BridgeError, on, settingsApi, vaultApi } from '../lib/bridge'

interface VaultStoreState {
  status: VaultStatus | null
  settings: AppSettings | null
  loading: boolean
  error: string | null
  bootstrap: () => Promise<void>
  initialize: (password: string, confirm: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  lock: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  clearError: () => void
}

function messageOf(err: unknown): string {
  if (err instanceof BridgeError) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

export const useVaultStore = create<VaultStoreState>((set, get) => ({
  status: null,
  settings: null,
  loading: true,
  error: null,

  bootstrap: async () => {
    set({ loading: true, error: null })
    try {
      const [status, settings] = await Promise.all([vaultApi.status(), settingsApi.get()])
      set({ status, settings, loading: false })
    } catch (err) {
      set({ loading: false, error: messageOf(err) })
    }
  },

  initialize: async (password, confirm) => {
    if (password !== confirm) {
      set({ error: translate(normalizeLocale(get().settings?.language), 'lock.mismatch') })
      return
    }
    set({ error: null })
    try {
      set({ status: await vaultApi.initialize(password) })
    } catch (err) {
      set({ error: messageOf(err) })
    }
  },

  unlock: async (password) => {
    set({ error: null })
    try {
      set({ status: await vaultApi.unlock(password) })
    } catch (err) {
      set({ error: messageOf(err), status: await vaultApi.status() })
    }
  },

  lock: async () => {
    set({ status: await vaultApi.lock(), error: null })
  },

  updateSettings: async (patch) => {
    const previous = get().settings
    if (previous) {
      set({ settings: { ...previous, ...patch }, error: null })
    }
    try {
      const settings = await settingsApi.update(patch)
      set({ settings, status: await vaultApi.status() })
    } catch (err) {
      set({ settings: previous, error: messageOf(err) })
    }
  },

  clearError: () => {
    if (get().error) set({ error: null })
  },
}))

/** 订阅主进程的锁定/解锁事件，只需在应用启动时调用一次。 */
export function subscribeVaultEvents(): () => void {
  const offLocked = on(IPC_EVENT.vaultLocked, (payload) => {
    useVaultStore.setState({ status: payload as VaultStatus })
  })
  const offUnlocked = on(IPC_EVENT.vaultUnlocked, (payload) => {
    useVaultStore.setState({ status: payload as VaultStatus })
  })
  return () => {
    offLocked()
    offUnlocked()
  }
}
