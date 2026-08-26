import type { ReactNode } from 'react'
import { useBrowserStore } from '../store/browserStore'

const WEBVIEW_PREFS = 'contextIsolation=yes, nodeIntegration=no, sandbox=yes, javascript=yes'

export function BrowserChrome({ children }: { children: ReactNode }) {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeId = useBrowserStore((s) => s.activeId)
  const activate = useBrowserStore((s) => s.activate)
  const close = useBrowserStore((s) => s.close)
  const showTabs = tabs.length > 0
  const walletActive = activeId === null

  return (
    <div className="flex h-full flex-col">
      {showTabs ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-800 bg-ink-900 px-2 py-1">
          <button
            type="button"
            className={`shrink-0 rounded-md px-3 py-1 text-xs ${
              walletActive ? 'bg-ink-700 text-honey-400' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
            }`}
            onClick={() => activate(null)}
          >
            钱包
          </button>
          {tabs.map((tab) => {
            const active = tab.id === activeId
            return (
              <div
                key={tab.id}
                className={`flex max-w-[220px] shrink-0 items-center rounded-md ${
                  active ? 'bg-ink-700 text-honey-400' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 truncate px-3 py-1 text-xs"
                  title={tab.url}
                  onClick={() => activate(tab.id)}
                >
                  {tab.title}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-ink-500 hover:text-ink-200"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={() => close(tab.id)}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div className={walletActive ? 'h-full overflow-hidden' : 'hidden'}>{children}</div>
        {tabs.map((tab) => {
          const active = tab.id === activeId
          return (
            <webview
              key={tab.id}
              src={tab.url}
              partition="persist:explorer"
              webpreferences={WEBVIEW_PREFS}
              className="explorer-webview"
              style={
                active
                  ? { display: 'flex', position: 'absolute', inset: 0 }
                  : { display: 'none' }
              }
            />
          )
        })}
      </div>
    </div>
  )
}
