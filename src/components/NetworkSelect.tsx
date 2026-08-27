import { useEffect, useRef, useState } from 'react'
import type { NetworkRecord } from '@shared/types'

export function NetworkIcon({ src, name, size = 20 }: { src?: string | null; name?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const letter = (name ?? '?').trim().slice(0, 1).toUpperCase()
  if (!src || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink-700 text-[10px] font-semibold text-honey-400"
        style={{ width: size, height: size }}
      >
        {letter}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className="shrink-0 rounded-full bg-ink-700 object-cover"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}

function labelOf(network: NetworkRecord): string {
  return network.chainName ? `${network.networkName} (${network.chainName})` : network.networkName
}

export function NetworkSelect({
  label = '网络',
  networks,
  value,
  onChange,
  className = '',
}: {
  label?: string
  networks: NetworkRecord[]
  value: string
  onChange: (id: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = networks.find((item) => item.id === value) ?? null

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={rootRef} className={`relative min-w-[260px] ${className}`}>
      <span className="mb-1 block text-xs font-medium text-ink-400">{label}</span>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-left text-sm text-ink-200 outline-none hover:border-honey-500 focus:border-honey-500"
        onClick={() => setOpen((current) => !current)}
      >
        <NetworkIcon src={selected?.icon} name={selected?.networkName} />
        <span className="min-w-0 flex-1 truncate">{selected ? labelOf(selected) : '选择网络'}</span>
        <span className="text-[10px] text-ink-500">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-ink-600 bg-ink-900 py-1 shadow-lg">
          {networks.map((item) => {
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
                  <NetworkIcon src={item.icon} name={item.networkName} />
                  <span className="min-w-0 truncate">{labelOf(item)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
