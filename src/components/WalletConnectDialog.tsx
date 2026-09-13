import { useEffect, useState } from 'react'
import type { WalletConnectPairing, WalletConnectPending } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { on, walletConnectApi } from '../lib/bridge'
import { watchWalletConnectPairingOverlay } from '../lib/wcPairingOverlay'
import { Button, Modal } from './ui'
import { useT, type MessageKey } from '../i18n'

const TITLE_KEY: Record<WalletConnectPending['kind'], MessageKey> = {
  session: 'wc.sessionTitle',
  auth: 'wc.authTitle',
  sign: 'wc.signTitle',
  send: 'wc.sendTitle',
  switch: 'wc.switchTitle',
}

export function useWalletConnectUi() {
  const [queue, setQueue] = useState<WalletConnectPending[]>([])
  const [pairing, setPairing] = useState<WalletConnectPairing>({ active: false, error: null, deadlineAt: null })
  const current = queue[0] ?? null

  useEffect(() => {
    void walletConnectApi.pending().then(setQueue).catch(() => undefined)
    void walletConnectApi.pairing().then(setPairing).catch(() => undefined)
    const offRequest = on(IPC_EVENT.walletConnectRequest, (payload) => {
      const item = payload as WalletConnectPending
      setQueue((prev) => (prev.some((row) => row.id === item.id) ? prev : [...prev, item]))
    })
    const offPending = on(IPC_EVENT.walletConnectPending, (payload) => {
      if (Array.isArray(payload)) setQueue(payload as WalletConnectPending[])
    })
    const offPairing = on(IPC_EVENT.walletConnectPairing, (payload) => {
      if (payload && typeof payload === 'object') setPairing(payload as WalletConnectPairing)
    })
    return () => {
      offRequest()
      offPending()
      offPairing()
    }
  }, [])

  return { current, pairing }
}

/** 等待配对：挡住操作，网站还看得见，超时自动关。 */
export function WalletConnectWaitLock() {
  const t = useT()
  const { current, pairing } = useWalletConnectUi()
  const [now, setNow] = useState(Date.now())
  const waiting = pairing.active && !current
  const left = Math.max(0, Math.ceil(((pairing.deadlineAt ?? now) - now) / 1000))
  const leftText = t('wc.waitingLeft', { seconds: left })

  useEffect(() => {
    if (!waiting) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [waiting])

  useEffect(() => {
    return watchWalletConnectPairingOverlay(waiting, t('wc.waitingTitle'), t('wc.waiting'), leftText)
  }, [waiting, leftText, t])

  if (!waiting && !pairing.error) return null
  if (!waiting && pairing.error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="w-full max-w-md rounded-xl border border-ink-600 bg-ink-900 p-5 shadow-2xl">
          <h2 className="text-sm font-semibold text-ink-200">{t('wc.waitingTitle')}</h2>
          <p className="mt-3 text-sm text-red-300">{pairing.error}</p>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={() => void walletConnectApi.cancelPair()}>
              {t('wc.cancelWait')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  if (!waiting) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-ink-600 bg-ink-900 p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-honey-400 border-t-transparent" />
          <h2 className="text-sm font-semibold text-ink-200">{t('wc.waitingTitle')}</h2>
        </div>
        <p className="mt-3 text-sm text-ink-300">{t('wc.waiting')}</p>
        <p className="mt-2 text-xs text-ink-500">{leftText}</p>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={() => void walletConnectApi.cancelPair()}>
            {t('wc.cancelWait')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function WalletConnectDialog({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const t = useT()
  const { current } = useWalletConnectUi()
  const [busy, setBusy] = useState(false)
  const [copyState, setCopyState] = useState<{ id: string; status: 'copied' | 'failed' } | null>(null)

  useEffect(() => {
    onOpenChange?.(Boolean(current))
  }, [current, onOpenChange])

  const decide = async (approve: boolean) => {
    if (!current) return
    setBusy(true)
    try {
      await walletConnectApi.decide(current.id, approve)
    } finally {
      setBusy(false)
    }
  }

  const copyDetail = async () => {
    if (!current) return
    const { id, detail } = current
    try {
      await navigator.clipboard.writeText(detail)
      setCopyState({ id, status: 'copied' })
    } catch {
      setCopyState({ id, status: 'failed' })
    }
  }

  if (!current) return null
  const copyStatus = copyState?.id === current.id ? copyState.status : null

  return (
    <Modal
      title={t(TITLE_KEY[current.kind])}
      onClose={() => void decide(false)}
      wide
      className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
    >
      <p className="mt-3 shrink-0 text-xs text-ink-500">{t('wc.hint')}</p>
      {current.verification && current.verification !== 'VALID' && (
        <p className="mt-3 shrink-0 text-sm text-amber-400" role="alert">
          {t(current.verification === 'UNKNOWN' ? 'wc.verifyUnknown'
            : current.verification === 'SCAM' ? 'wc.verifyScam' : 'wc.verifyInvalid')}
        </p>
      )}
      <dl className="mt-3 shrink-0 space-y-2 text-sm">
        <div>
          <dt className="text-ink-500">{t('wc.site')}</dt>
          <dd className="truncate text-ink-200" title={current.name}>{current.name}</dd>
        </div>
        <div>
          <dt className="text-ink-500">{t('wc.origin')}</dt>
          <dd className="truncate text-ink-200" title={current.origin}>{current.origin}</dd>
        </div>
      </dl>
      <div className="mt-3 flex min-h-0 flex-col">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-3">
          <span className="text-sm text-ink-500">{t('wc.detail')}</span>
          <div className="flex items-center gap-2">
            <span role="status" className="text-xs text-amber-400">
              {copyStatus === 'failed' ? t('wc.copyFailed') : ''}
            </span>
            <Button type="button" variant="ghost" className="px-3 py-1 text-xs" onClick={() => void copyDetail()}>
              {copyStatus === 'copied' ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
        </div>
        <div
          key={current.id}
          role="region"
          aria-label={t('wc.detail')}
          tabIndex={0}
          className="min-h-0 max-h-[45vh] overflow-y-auto overscroll-contain rounded-lg border border-ink-600 bg-ink-950/50 p-3 focus-visible:outline focus-visible:outline-honey-500"
          style={{ scrollbarGutter: 'stable' }}
        >
          <pre className="m-0 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-ink-200">{current.detail}</pre>
        </div>
      </div>
      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-ink-700 pt-4">
        <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
          {t('wc.reject')}
        </Button>
        <Button disabled={busy} loading={busy} onClick={() => void decide(true)}>
          {t('wc.approve')}
        </Button>
      </div>
    </Modal>
  )
}
