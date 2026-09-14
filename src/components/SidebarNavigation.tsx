import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { navigationGroups } from '@shared/navigation'
import { useT } from '../i18n'

export function SidebarNavigation() {
  const t = useT()
  const navRef = useRef<HTMLElement>(null)
  const revealedPath = useRef<string | null>(null)
  const { pathname } = useLocation()
  const activeGroup = navigationGroups.find((group) => group.items.some((item) =>
    pathname === item.to || (item.to !== '/' && pathname.startsWith(`${item.to}/`)),
  ))?.id
  const [expanded, setExpanded] = useState<string[]>(() =>
    activeGroup && activeGroup !== 'assets' ? ['assets', activeGroup] : ['assets'],
  )

  // 顶部菜单、页面内跳转及浏览器前进后退都要展开目标页面所在的分组。
  useEffect(() => {
    if (activeGroup) {
      setExpanded((previous) => previous.includes(activeGroup) ? previous : [...previous, activeGroup])
    }
  }, [activeGroup, pathname])

  useEffect(() => {
    if (!activeGroup) {
      revealedPath.current = pathname
      return
    }
    if (revealedPath.current === pathname || !expanded.includes(activeGroup)) return
    const currentLink = navRef.current?.querySelector('a[aria-current="page"]')
    if (currentLink) {
      currentLink.scrollIntoView({ block: 'nearest' })
      revealedPath.current = pathname
    }
  }, [activeGroup, expanded, pathname])

  return (
    <nav ref={navRef} aria-label={t('nav.main')} className="sidebar-scroll min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-2">
      {navigationGroups.map((group) => {
        const open = expanded.includes(group.id)
        const active = activeGroup === group.id
        return (
          <section key={group.id} aria-labelledby={`nav-heading-${group.id}`}>
            <h2>
              <button
                id={`nav-heading-${group.id}`}
                type="button"
                aria-expanded={open}
                aria-controls={`nav-items-${group.id}`}
                onClick={() => setExpanded((previous) => open
                  ? previous.filter((id) => id !== group.id)
                  : [...previous, group.id])}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs font-semibold transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-honey-500 ${active ? 'text-honey-400' : 'text-ink-400 hover:text-ink-200'}`}
              >
                <span>{t(group.key)}</span>
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>
                  <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h2>
            <ul id={`nav-items-${group.id}`} hidden={!open} className="ml-2 space-y-0.5 border-l border-ink-700 pl-2">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2 text-sm leading-snug transition-colors focus-visible:outline-2 focus-visible:outline-honey-500 ${isActive
                        ? 'bg-ink-700 text-honey-400'
                        : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'}`
                    }
                  >
                    {t(item.key)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}
