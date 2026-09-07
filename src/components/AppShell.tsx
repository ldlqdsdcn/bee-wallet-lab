import { useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useVaultStore } from '../store/vaultStore'
import { vaultApi } from '../lib/bridge'
import { Button } from './ui'
import { WalletSelect } from './WalletSelect'
import { CurrentNetwork } from './CurrentNetwork'
import { AppMenuBridge } from './AppMenuBridge'
import { NetworkSwitchDialog } from './NetworkSwitchDialog'
import { useNetworkStore } from '../store/networkStore'
import logoUrl from '../assets/logo.png'

const navItems = [
  { to: '/', label: '资产总览' },
  { to: '/wallets', label: '钱包与账户' },
  { to: '/hd', label: '分层钱包' },
  { to: '/transfer', label: '收款转账' },
  { to: '/issue', label: '发行代币' },
  { to: '/hd-airdrop', label: '批量转账' },
  { to: '/activity', label: '交易记录' },
  { to: '/address-book', label: '地址簿' },
  { to: '/sign', label: '消息签名' },
]

/** 用户活动上报节流间隔 */
const TOUCH_INTERVAL = 30_000

export default function AppShell() {
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
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900 p-4">
        <div className="mb-4 flex items-center gap-2">
          <img src={logoUrl} alt="" className="h-8 w-8 select-none" draggable={false} />
          <span className="text-sm font-semibold text-ink-200">Bee Wallet Lab</span>
        </div>
        <div className="mb-4 space-y-3">
          <WalletSelect />
          <CurrentNetwork />
        </div>
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-ink-700 text-honey-400'
                    : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-ink-800 pt-4">
          <p className="text-xs text-ink-600">
            {autoLockMinutes > 0 ? `空闲 ${autoLockMinutes} 分钟自动锁定` : '未开启自动锁定'}
          </p>
          <Button variant="ghost" className="w-full" onClick={() => void lock()}>
            立即锁定
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
