import { useEffect, useState } from 'react'
import type { AccountRecord, SignMessageResult, WalletType } from '@shared/types'
import { accountApi, signApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select, TextArea } from '../components/ui'
import { shorten, walletTypeLabel } from '../lib/format'
import { useWalletStore } from '../store/walletStore'

export default function SignPage() {
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
      <h1 className="text-lg font-semibold text-ink-200">消息签名</h1>
      <Alert>{error}</Alert>

      <Card title="签名">
        <div className="space-y-3">
          <Select label="账户" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || walletTypeLabel(item.walletType)} · {shorten(item.address, 8, 6)}
              </option>
            ))}
          </Select>
          <TextArea
            label="消息"
            value={message}
            hint={
              account?.walletType === 'bitcoin'
                ? 'Bitcoin 使用 BIP-137 signmessage'
                : 'EVM / TRON 使用 EIP-191 personal_sign'
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
            签名
          </Button>
          {result ? (
            <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
              <p>方案 {result.scheme}</p>
              <p className="sensitive break-all">摘要 {result.digest}</p>
              <p className="sensitive break-all text-honey-400">{result.signature}</p>
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="验签">
        <div className="space-y-3">
          <Select
            label="链"
            value={verifyType}
            onChange={(e) => setVerifyType(e.target.value as WalletType)}
          >
            <option value="web3">EVM</option>
            <option value="bitcoin">Bitcoin</option>
            <option value="tron">TRON</option>
          </Select>
          <Field
            label="地址"
            className="sensitive"
            value={verifyAddress}
            onChange={(e) => setVerifyAddress(e.target.value)}
          />
          <TextArea label="消息" value={verifyMessage} onChange={(e) => setVerifyMessage(e.target.value)} />
          <TextArea
            label="签名"
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
                    ? `通过${verified.recoveredAddress ? ` · 恢复地址 ${verified.recoveredAddress}` : ''}`
                    : `未通过${verified.recoveredAddress ? ` · 恢复地址 ${verified.recoveredAddress}` : ''}`,
                )
              })
            }
          >
            验签
          </Button>
          {verifyResult ? <p className="text-sm text-honey-400">{verifyResult}</p> : null}
        </div>
      </Card>
    </div>
  )
}
