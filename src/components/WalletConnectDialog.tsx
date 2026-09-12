import { useEffect, useState } from 'react'
import type { WalletConnectPending } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { on, walletConnectApi } from '../lib/bridge'
import { Button, Modal } from './ui'
import { useT, type MessageKey } from '../i18n'

const TITLE_KEY: Record<WalletConnectPending['kind'], MessageKey> = {
  session: 'wc.sessionTitle',
  auth: 'wc.authTitle',
  sign: 'wc.signTitle',
  send: 'wc.sendTitle',
  switch: 'wc.switchTitle',
}

export function WalletConnectDialog({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const t = useT()
  const [queue, setQueue] = useState<WalletConnectPending[]>([])
  const [busy, setBusy] = useState(false)
  const current = queue[0] ?? null

  useEffect(() => {
    onOpenChange?.(Boolean(current))
  }, [current, onOpenChange])

  useEffect(() => {
    void walletConnectApi.pending().then(setQueue).catch(() => undefined)
    const offRequest = on(IPC_EVENT.walletConnectRequest, (payload) => {
      const item = payload as WalletConnectPending
      setQueue((prev) => (prev.some((row) => row.id === item.id) ? prev : [...prev, item]))
    })
    const offPending = on(IPC_EVENT.walletConnectPending, (payload) => {
      if (Array.isArray(payload)) setQueue(payload as WalletConnectPending[])
    })
    return () => {
      offRequest()
      offPending()
    }
  }, [])

  const decide = async (approve: boolean) => {
    if (!current) return
    setBusy(true)
    try {
      await walletConnectApi.decide(current.id, approve)
    } finally {
      setBusy(false)
    }
  }

  if (!current) return null

  return (
    <Modal title={t(TITLE_KEY[current.kind])} onClose={() => void decide(false)} wide>
      <p className="mt-3 text-xs text-ink-500">{t('wc.hint')}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-ink-500">{t('wc.site')}</dt>
          <dd className="break-all text-ink-200">{current.name}</dd>
        </div>
        <div>
          <dt className="text-ink-500">{t('wc.origin')}</dt>
          <dd className="break-all text-ink-200">{current.origin}</dd>
        </div>
        <div>
          <dt className="text-ink-500">{t('wc.detail')}</dt>
          <dd className="whitespace-pre-wrap break-all font-mono text-xs text-ink-200">{current.detail}</dd>
        </div>
      </dl>
      <div className="mt-5 flex justify-end gap-2">
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
