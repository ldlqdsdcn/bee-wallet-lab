import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useVaultStore } from '../store/vaultStore'
import { vaultApi } from '../lib/bridge'
import { Button } from './ui'
import { WalletSelect } from './WalletSelect'
import { CurrentNetwork } from './CurrentNetwork'
import { AppMenuBridge } from './AppMenuBridge'
import { NetworkSwitchDialog } from './NetworkSwitchDialog'
import { LanguageSwitch } from './LanguageSwitch'
import { useNetworkStore } from '../store/networkStore'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import logoUrl from '../assets/logo.png'

const navItems: { to: string; key: MessageKey }[] = [
  { to: '/', key: 'nav.home' },
  { to: '/wallets', key: 'nav.wallets' },
  { to: '/hd', key: 'nav.hd' },
  { to: '/transfer', key: 'nav.transfer' },
  { to: '/swap', key: 'nav.swap' },
  { to: '/bridge', key: 'nav.bridge' },
  { to: '/tx-lab', key: 'nav.txLab' },
  { to: '/abi', key: 'nav.abi' },
  { to: '/contract', key: 'nav.contract' },
  { to: '/dev-tools', key: 'nav.devTools' },
  { to: '/issue', key: 'nav.issue' },
  { to: '/hd-airdrop', key: 'nav.airdrop' },
  { to: '/activity', key: 'nav.activity' },
  { to: '/address-book', key: 'nav.addressBook' },
  { to: '/sign', key: 'nav.sign' },
]

/** 用户活动上报节流间隔 */
const TOUCH_INTERVAL = 30_000

export default function AppShell() {
  const t = useT()
  const lock = useVaultStore((s) => s.lock)
  const autoLockMinutes = useVaultStore((s) => s.settings?.autoLockMinutes ?? 0)
  const pickerOpen = useNetworkStore((s) => s.pickerOpen)
  const closePicker = useNetworkStore((s) => s.closePicker)
  const selectNetwork = useNetworkStore((s) => s.select)

  // 有交互就续期空闲计时，避免用户操作中途被锁
  useEffect(() => {
    let last = 0
    const report = () => {
      const now = Date.now()
      if (now - last < TOUCH_INTERVAL) return
      last = now
      void vaultApi.touch().catch(() => undefined)
    }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel']
    events.forEach((e) => window.addEventListener(e, report, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, report))
  }, [])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r border-ink-800 bg-ink-900">
        <div className="shrink-0 space-y-3 p-4 pb-3">
          <div className="flex items-center gap-2">
            <img src={logoUrl} alt="" className="h-8 w-8 select-none" draggable={false} />
            <span className="text-sm font-semibold text-ink-200">Bee Wallet Lab</span>
          </div>
          <WalletSelect />
          <CurrentNetwork />
        </div>
        <nav className="sidebar-scroll min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm leading-snug transition-colors ${
                  isActive
                    ? 'bg-ink-700 text-honey-400'
                    : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
                }`
              }
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-ink-800 p-4">
          <LanguageSwitch compact />
          <p className="text-xs text-ink-600">
            {autoLockMinutes > 0 ? t('nav.autoLock', { minutes: autoLockMinutes }) : t('nav.autoLockOff')}
          </p>
          <Button variant="ghost" className="w-full" onClick={() => void lock()}>
            {t('nav.lockNow')}
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <AppMenuBridge />
        <Outlet />
      </main>
      {pickerOpen ? (
        <NetworkSwitchDialog onPick={(id) => void selectNetwork(id)} onClose={closePicker} />
      ) : null}
    </div>
  )
}
