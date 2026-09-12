import { useEffect, useRef, useState } from 'react'
import type { TokenRecord } from '@shared/types'
import { NetworkIcon } from './NetworkSelect'
import { formatAmount, shorten } from '../lib/format'
import { useT } from '../i18n'

export function TokenSelect({
  label,
  tokens,
  value,
  onChange,
  balances,
  className = '',
}: {
  label?: string
  tokens: TokenRecord[]
  value: string
  onChange: (id: string) => void
  balances?: Record<string, string>
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = tokens.find((item) => item.id === value) ?? null
  const caption = (token: TokenRecord) => {
    const balance = balances?.[token.id]
    if (balance != null) return formatAmount(balance)
    if (!token.isToken) return t('common.nativeToken')
    if (token.contractAddress) return shorten(token.contractAddress, 6, 4)
    return token.tokenStandard || t('common.token')
  }

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <span className="mb-1 block text-xs font-medium text-ink-400">{label ?? t('token.label')}</span>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-left text-sm text-ink-200 outline-none hover:border-honey-500 focus:border-honey-500"
        onClick={() => setOpen((current) => !current)}
      >
        <NetworkIcon src={selected?.tokenIcon} name={selected?.symbol} />
        <span className="min-w-0 flex-1 truncate">
          {selected ? `${selected.symbol} · ${selected.name}` : tokens.length ? t('token.select') : t('token.none')}
        </span>
        {selected && balances?.[selected.id] != null ? (
          <span className="shrink-0 text-[11px] text-ink-400">{formatAmount(balances[selected.id])}</span>
        ) : null}
        <span className="shrink-0 text-[10px] text-ink-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && tokens.length > 0 ? (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-600 bg-ink-900 py-1 shadow-lg">
          {tokens.map((item) => {
            const active = item.id === value
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    active ? 'bg-ink-700 text-honey-400' : 'text-ink-200 hover:bg-ink-800'
                  }`}
                  onClick={() => {
                    onChange(item.id)
                    setOpen(false)
                  }}
                >
                  <NetworkIcon src={item.tokenIcon} name={item.symbol} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.symbol}</span>
                    <span className="block truncate text-[11px] text-ink-500">{item.name}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-600">{caption(item)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
