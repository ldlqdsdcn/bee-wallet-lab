import { create } from 'zustand'
import { IPC_EVENT } from '@shared/ipc'
import type { AddressBookEntry, AddressBookQuery, AddressBookUpsertInput } from '@shared/types'
import { addressBookApi, on } from '../lib/bridge'

interface AddressBookState {
  entries: AddressBookEntry[]
  loading: boolean
  error: string | null
  query: AddressBookQuery
  load: (query?: AddressBookQuery) => Promise<void>
  save: (input: AddressBookUpsertInput) => Promise<boolean>
  remove: (id: string) => Promise<void>
  setError: (message: string | null) => void
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const useAddressBookStore = create<AddressBookState>((set, get) => ({
  entries: [],
  loading: false,
  error: null,
  query: {},

  load: async (query) => {
    const next = query ?? get().query
    set({ loading: true, error: null, query: next })
    try {
      set({ entries: await addressBookApi.list(next), loading: false })
    } catch (err) {
      set({ loading: false, error: messageOf(err) })
    }
  },

  save: async (input) => {
    set({ error: null })
    try {
      await addressBookApi.upsert(input)
      await get().load()
      return true
    } catch (err) {
      set({ error: messageOf(err) })
      return false
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await addressBookApi.remove(id)
      await get().load()
    } catch (err) {
      set({ error: messageOf(err) })
    }
  },

  setError: (message) => set({ error: message }),
}))

/** 地址簿变更事件订阅，多窗口或主进程侧改动都能刷新列表。 */
export function subscribeAddressBookEvents(): () => void {
  return on(IPC_EVENT.addressBookUpdated, () => {
    void useAddressBookStore.getState().load()
  })
}
