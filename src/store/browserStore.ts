import { create } from 'zustand'
import { explorerTabTitle } from '../lib/explorer'

export interface ExplorerTab {
  id: string
  title: string
  url: string
}

interface BrowserState {
  tabs: ExplorerTab[]
  /** null 表示显示钱包界面 */
  activeId: string | null
  open: (url: string, title?: string) => void
  close: (id: string) => void
  activate: (id: string | null) => void
  closeAll: () => void
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  tabs: [],
  activeId: null,

  open: (url, title) => {
    const existing = get().tabs.find((item) => item.url === url)
    if (existing) {
      set({ activeId: existing.id })
      return
    }
    const tab: ExplorerTab = {
      id: crypto.randomUUID(),
      url,
      title: title?.trim() || explorerTabTitle(url),
    }
    set({ tabs: [...get().tabs, tab], activeId: tab.id })
  },

  close: (id) => {
    const tabs = get().tabs.filter((item) => item.id !== id)
    const activeId = get().activeId === id ? null : get().activeId
    set({ tabs, activeId })
  },

  activate: (id) => set({ activeId: id }),

  closeAll: () => set({ tabs: [], activeId: null }),
}))
