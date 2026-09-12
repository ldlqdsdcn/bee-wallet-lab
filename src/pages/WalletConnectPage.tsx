import { useEffect, useState } from 'react'
import type { WalletConnectSession, WalletConnectStatus } from '@shared/types'
import { IPC_EVENT } from '@shared/ipc'
import { on, walletConnectApi } from '../lib/bridge'
import { Alert, Button, Card, TextArea } from '../components/ui'
import { useT } from '../i18n'

export default function WalletConnectPage() {
  const t = useT()
  const [status, setStatus] = useState<WalletConnectStatus | null>(null)
  const [sessions, setSessions] = useState<WalletConnectSession[]>([])
  const [uri, setUri] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => {
    void walletConnectApi.status().then(setStatus).catch((err) => setError(String(err)))
    void walletConnectApi.sessions().then(setSessions).catch(() => undefined)
  }

  useEffect(() => {
    refresh()
    const offSessions = on(IPC_EVENT.walletConnectSessions, (payload) => {
      if (Array.isArray(payload)) setSessions(payload as WalletConnectSession[])
    })
    return () => {
      offSessions()
    }
  }, [])

  const pair = async (raw = uri) => {
    setBusy(true)
    setError(null)
    try {
      const next = await walletConnectApi.pair(raw)
      setSessions(next)
      setUri('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pairClipboard = async () => {
    setBusy(true)
    setError(null)
    try {
      const text = await walletConnectApi.clipboard()
      if (!text.trim()) throw new Error(t('wc.clipboardEmpty'))
      setUri(text)
      const next = await walletConnectApi.pair(text)
      setSessions(next)
      setUri('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (topic: string) => {
    setBusy(true)
    setError(null)
    try {
      setSessions(await walletConnectApi.disconnect(topic))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('wc.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">{t('wc.subtitle')}</p>
      </div>
      <Alert>{error ?? (status && !status.projectIdSet ? status.error : null)}</Alert>

      <Card title={t('wc.pair')}>
        <div className="space-y-3">
          <TextArea
            label={t('wc.uri')}
            hint={t('wc.uriHint')}
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="wc:..."
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !uri.trim() || !status?.projectIdSet} loading={busy} onClick={() => void pair()}>
              {t('wc.connect')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !status?.projectIdSet}
              onClick={() => void pairClipboard()}
            >
              {t('wc.paste')}
            </Button>
          </div>
        </div>
      </Card>

      <Card title={t('wc.sessions', { count: sessions.length })}>
        {sessions.length === 0 ? (
          <p className="text-sm text-ink-400">{t('wc.empty')}</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {sessions.map((item) => (
              <li key={item.topic} className="flex items-center gap-3 py-3">
                {item.icon ? (
                  <img src={item.icon} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-700 text-xs text-ink-400">
                    {item.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-200">{item.name}</p>
                  <p className="truncate font-mono text-[11px] text-ink-600">{item.url || item.topic}</p>
                  {item.chains.length ? (
                    <p className="mt-0.5 text-[11px] text-ink-500">{item.chains.join(' · ')}</p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  className="shrink-0 px-2 py-1 text-xs"
                  disabled={busy}
                  onClick={() => void disconnect(item.topic)}
                >
                  {t('wc.disconnect')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
