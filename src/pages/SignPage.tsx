import { useEffect, useState } from 'react'
import type { AccountRecord, SignMessageResult, WalletType } from '@shared/types'
import { accountApi, signApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select, TextArea } from '../components/ui'
import { shorten, walletTypeLabel } from '../lib/format'
import { useWalletStore } from '../store/walletStore'
import { useT } from '../i18n'

export default function SignPage() {
  const t = useT()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [accountId, setAccountId] = useState('')
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<SignMessageResult | null>(null)
  const [verifyType, setVerifyType] = useState<WalletType>('web3')
  const [verifyAddress, setVerifyAddress] = useState('')
  const [verifyMessage, setVerifyMessage] = useState('')
  const [verifySignature, setVerifySignature] = useState('')
  const [verifyResult, setVerifyResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentWalletId) {
      setAccounts([])
      setAccountId('')
      return
    }
    void accountApi.list(currentWalletId).then((list) => {
      setAccounts(list)
      if (list[0]) setAccountId(list[0].id)
    })
  }, [currentWalletId])

  const account = accounts.find((item) => item.id === accountId)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-lg font-semibold text-ink-200">{t('sign.title')}</h1>
      <Alert>{error}</Alert>

      <Card title={t('sign.card')}>
        <div className="space-y-3">
          <Select label={t('common.account')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || walletTypeLabel(item.walletType)} · {shorten(item.address, 8, 6)}
              </option>
            ))}
          </Select>
          <TextArea
            label={t('sign.message')}
            value={message}
            hint={
              account?.walletType === 'bitcoin'
                ? t('sign.hintBtc')
                : account?.walletType === 'solana'
                  ? t('sign.hintSol')
                  : t('sign.hintEvm')
            }
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button
            disabled={busy || !accountId || !message}
            onClick={() =>
              void run(async () => {
                const signed = await signApi.sign({ accountId, message })
                setResult(signed)
                setVerifyType(signed.walletType)
                setVerifyAddress(signed.address)
                setVerifyMessage(message)
                setVerifySignature(signed.signature)
              })
            }
          >
            {t('sign.action')}
          </Button>
          {result ? (
            <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
              <p>{t('sign.scheme', { scheme: result.scheme })}</p>
              <p className="sensitive break-all">{t('sign.digest', { digest: result.digest })}</p>
              <p className="sensitive break-all text-honey-400">{result.signature}</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title={t('sign.verify')}>
        <div className="space-y-3">
          <Select
            label={t('sign.chain')}
            value={verifyType}
            onChange={(e) => setVerifyType(e.target.value as WalletType)}
          >
            <option value="web3">EVM</option>
            <option value="bitcoin">Bitcoin</option>
            <option value="tron">TRON</option>
            <option value="solana">Solana</option>
          </Select>
          <Field
            label={t('common.address')}
            className="sensitive"
            value={verifyAddress}
            onChange={(e) => setVerifyAddress(e.target.value)}
          />
          <TextArea label={t('sign.message')} value={verifyMessage} onChange={(e) => setVerifyMessage(e.target.value)} />
          <TextArea
            label={t('sign.signature')}
            className="sensitive"
            value={verifySignature}
            onChange={(e) => setVerifySignature(e.target.value)}
          />
          <Button
            disabled={busy || !verifyAddress || !verifyMessage || !verifySignature}
            onClick={() =>
              void run(async () => {
                const verified = await signApi.verify({
                  walletType: verifyType,
                  address: verifyAddress,
                  message: verifyMessage,
                  signature: verifySignature,
                })
                setVerifyResult(
                  verified.valid
                    ? verified.recoveredAddress
                      ? t('sign.passRecovered', { address: verified.recoveredAddress })
                      : t('sign.pass')
                    : verified.recoveredAddress
                      ? t('sign.failRecovered', { address: verified.recoveredAddress })
                      : t('sign.fail'),
                )
              })
            }
          >
            {t('sign.verify')}
          </Button>
          {verifyResult ? <p className="text-sm text-honey-400">{verifyResult}</p> : null}
        </div>
      </Card>
    </div>
  )
}
