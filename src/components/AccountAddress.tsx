import { useState } from 'react'
import { shorten } from '../lib/format'
import { explorerTabTitle } from '../lib/explorer'
import { useBrowserStore } from '../store/browserStore'

export function AccountAddress({
  address,
  explorerUrl,
  label,
}: {
  address: string
  explorerUrl: string | null
  label?: string
}) {
  const open = useBrowserStore((s) => s.open)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {label ? <span className="shrink-0 text-[10px] uppercase text-ink-500">{label}</span> : null}
      <span className="sensitive truncate text-xs text-ink-300" title={address}>
        {shorten(address)}
      </span>
      <button
        type="button"
        className="shrink-0 text-[11px] text-honey-400 hover:text-honey-500"
        onClick={() => void copy()}
      >
        {copied ? '已复制' : '复制'}
      </button>
      {explorerUrl ? (
        <button
          type="button"
          className="shrink-0 text-[11px] text-honey-400 hover:text-honey-500"
          onClick={() => open(explorerUrl, explorerTabTitle(explorerUrl))}
        >
          浏览器
        </button>
      ) : null}
    </div>
  )
}
