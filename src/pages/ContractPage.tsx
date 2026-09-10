import { useEffect, useMemo, useState } from 'react'
import { IPC_EVENT } from '@shared/ipc'
import type {
  AbiContractRecord,
  AbiFunctionInfo,
  AbiParamInfo,
  AbiParsed,
  AccountRecord,
  BroadcastResult,
  ContractReadResult,
  ContractSigned,
  ContractWritePreview,
  FeeLevel,
} from '@shared/types'
import { abiApi, accountApi, contractApi, on, txLabApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select, TextArea } from '../components/ui'
import { explorerTabTitle } from '../lib/explorer'
import { shorten, walletTypeLabel } from '../lib/format'
import { useBrowserStore } from '../store/browserStore'
import { useWalletStore } from '../store/walletStore'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { useT, type MessageKey } from '../i18n'

function isRead(fn: AbiFunctionInfo): boolean {
  return fn.stateMutability === 'view' || fn.stateMutability === 'pure'
}

export default function ContractPage() {
  const t = useT()
  const currentWalletId = useWalletStore((s) => s.currentId)
  const networks = useNetworkStore((s) => s.networks)
  const networkPk = useNetworkStore((s) => s.currentPk)
  const network = currentNetworkOf({ networks, currentPk: networkPk })
  const openExplorer = useBrowserStore((s) => s.open)
  const supported = network?.walletType === 'web3' || network?.walletType === 'tron'

  const [tab, setTab] = useState<'read' | 'write'>('read')
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [accountId, setAccountId] = useState('')
  const [saved, setSaved] = useState<AbiContractRecord[]>([])
  const [savedId, setSavedId] = useState('')
  const [abiText, setAbiText] = useState('')
  const [parsed, setParsed] = useState<AbiParsed | null>(null)
  const [contractAddress, setContractAddress] = useState('')
  const [fnSig, setFnSig] = useState('')
  const [args, setArgs] = useState<string[]>([])
  const [value, setValue] = useState('')
  const [feeLevel, setFeeLevel] = useState<FeeLevel>('medium')
  const [customFeeRate, setCustomFeeRate] = useState('')
  const [customPriorityFee, setCustomPriorityFee] = useState('')
  const [gasLimit, setGasLimit] = useState('')
  const [nonce, setNonce] = useState('')
  const [feeLimit, setFeeLimit] = useState('')
  const [readResult, setReadResult] = useState<ContractReadResult | null>(null)
  const [preview, setPreview] = useState<ContractWritePreview | null>(null)
  const [signed, setSigned] = useState<ContractSigned | null>(null)
  const [receipt, setReceipt] = useState<BroadcastResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const selectedFn = parsed?.functions.find((item) => item.signature === fnSig) ?? null
  const functions = useMemo(() => {
    const list = parsed?.functions ?? []
    return tab === 'read' ? list.filter(isRead) : list.filter((item) => !isRead(item))
  }, [parsed, tab])

  useEffect(() => {
    void abiApi.list().then(setSaved).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!currentWalletId) {
      setAccounts([])
      return
    }
    void accountApi.list(currentWalletId).then(setAccounts)
  }, [currentWalletId])

  const filteredAccounts = useMemo(() => {
    if (!network) return accounts
    return accounts.filter((item) => {
      if (item.walletType !== network.walletType) return false
      if (network.walletType === 'bitcoin') return item.networkScope === network.networkScope
      return true
    })
  }, [accounts, network])

  useEffect(() => {
    if (accountId && filteredAccounts.some((item) => item.id === accountId)) return
    if (filteredAccounts[0]) setAccountId(filteredAccounts[0].id)
    else setAccountId('')
  }, [filteredAccounts, accountId])

  useEffect(() => {
    setReadResult(null)
    setPreview(null)
    setSigned(null)
    setReceipt(null)
    setValue('')
    setGasLimit('')
    setNonce('')
    setFeeLimit('')
  }, [networkPk])

  useEffect(() => {
    const inputs = functions.find((item) => item.signature === fnSig)?.inputs ?? []
    setArgs(inputs.map(() => ''))
    setReadResult(null)
    setPreview(null)
    setSigned(null)
  }, [fnSig, functions])

  useEffect(() => {
    if (fnSig && functions.some((item) => item.signature === fnSig)) return
    setFnSig(functions[0]?.signature ?? '')
  }, [functions, fnSig])

  useEffect(() => {
    const txid = receipt?.txid
    if (!txid) return
    return on(IPC_EVENT.transactionUpdated, (payload) => {
      const record = (payload as { record?: BroadcastResult['transaction'] }).record
      if (!record || record.txid !== txid) return
      setReceipt((prev) =>
        prev ? { ...prev, transaction: record, explorerUrl: record.explorerUrl ?? prev.explorerUrl } : prev,
      )
    })
  }, [receipt?.txid])

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

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(label)
    window.setTimeout(() => setCopied((prev) => (prev === label ? null : prev)), 1500)
  }

  const applyParsed = (next: AbiParsed, address?: string) => {
    setParsed(next)
    setAbiText(prettyJson(next.abiJson))
    if (address || next.contractAddress) setContractAddress(address || next.contractAddress || '')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('contract.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">
          {network ? `${network.networkName} · ${walletTypeLabel(network.walletType)}` : t('contract.needNetwork')}
          {' · '}
          {t('contract.subtitle')}
        </p>
      </div>

      <Alert>{error}</Alert>

      {!supported ? (
        <Card title={t('network.current')}>
          <p className="text-sm text-ink-400">{t('contract.unsupported')}</p>
        </Card>
      ) : (
        <>
          <Card title={t('contract.card')}>
            <div className="space-y-3">
              <Select label={t('contract.caller')} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {filteredAccounts.length === 0 ? (
                  <option value="">{t('transfer.noAccount')}</option>
                ) : (
                  filteredAccounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label || item.walletType} · {shorten(item.address, 8, 6)}
                    </option>
                  ))
                )}
              </Select>
              <Field
                label={t('contract.address')}
                className="sensitive"
                value={contractAddress}
                placeholder={network.walletType === 'tron' ? t('contract.addressPhTron') : '0x…'}
                onChange={(e) => setContractAddress(e.target.value)}
              />
              {saved.length > 0 ? (
                <Select
                  label={t('contract.savedAbi')}
                  value={savedId}
                  onChange={(e) => {
                    const id = e.target.value
                    setSavedId(id)
                    const item = saved.find((row) => row.id === id)
                    if (!item) return
                    void run(async () => {
                      const next = await abiApi.parse(item.abiJson, item.name, item.contractAddress ?? undefined)
                      applyParsed(next, item.contractAddress ?? undefined)
                    })
                  }}
                >
                  <option value="">{t('abi.pickSaved')}</option>
                  {saved.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t('contract.fnCount', { name: item.name, count: item.functionCount })}
                    </option>
                  ))}
                </Select>
              ) : null}
              <TextArea
                label="ABI JSON"
                className="sensitive min-h-28 font-mono text-xs"
                hint={t('contract.abiHint')}
                value={abiText}
                onChange={(e) => setAbiText(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !abiText.trim()}
                  onClick={() =>
                    void run(async () => {
                      applyParsed(await abiApi.parse(abiText, undefined, contractAddress || undefined))
                    })
                  }
                >
                  {t('contract.parseAbi')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const preset = await abiApi.preset('erc20')
                      setAbiText(preset.abiJson)
                      applyParsed(await abiApi.parse(preset.abiJson, preset.name))
                    })
                  }
                >
                  {t('abi.loadErc20')}
                </Button>
              </div>
            </div>
          </Card>

          {parsed ? (
            <>
              <div className="flex gap-2">
                <Button variant={tab === 'read' ? 'primary' : 'ghost'} onClick={() => setTab('read')}>
                  {t('contract.read')}
                </Button>
                <Button variant={tab === 'write' ? 'primary' : 'ghost'} onClick={() => setTab('write')}>
                  {t('contract.write')}
                </Button>
              </div>

              <Card title={tab === 'read' ? 'Read Contract' : 'Write Contract'}>
                <div className="space-y-3">
                  <Select label={t('contract.fn')} value={fnSig} onChange={(e) => setFnSig(e.target.value)}>
                    {functions.length === 0 ? (
                      <option value="">{tab === 'read' ? t('contract.noRead') : t('contract.noWrite')}</option>
                    ) : (
                      functions.map((item) => (
                        <option key={item.signature} value={item.signature}>
                          {item.signature} · {item.stateMutability}
                        </option>
                      ))
                    )}
                  </Select>
                  {selectedFn ? (
                    <p className="break-all font-mono text-[11px] text-ink-500">{selectedFn.selector}</p>
                  ) : null}
                  {selectedFn?.inputs.map((input, index) => (
                    <Field
                      key={`${selectedFn.signature}-${index}`}
                      label={paramLabel(input, index)}
                      className="sensitive font-mono"
                      hint={paramHint(input, t)}
                      value={args[index] ?? ''}
                      onChange={(e) => setArgs((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))}
                    />
                  ))}

                  {tab === 'write' && selectedFn?.stateMutability === 'payable' ? (
                    <Field
                      label={t('contract.value', { symbol: network.coinEasy || (network.walletType === 'tron' ? 'TRX' : 'ETH') })}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  ) : null}

                  {tab === 'write' ? (
                    <>
                      <Select label={t('common.fee')} value={feeLevel} onChange={(e) => setFeeLevel(e.target.value as FeeLevel)}>
                        <option value="low">{t('common.slow')}</option>
                        <option value="medium">{t('common.standard')}</option>
                        <option value="high">{t('common.fast')}</option>
                        <option value="custom">{t('common.custom')}</option>
                      </Select>
                      {feeLevel === 'custom' && network.walletType === 'web3' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field
                            label="maxFeePerGas (gwei)"
                            value={customFeeRate}
                            onChange={(e) => setCustomFeeRate(e.target.value)}
                          />
                          <Field
                            label="maxPriorityFeePerGas (gwei)"
                            value={customPriorityFee}
                            onChange={(e) => setCustomPriorityFee(e.target.value)}
                          />
                        </div>
                      ) : null}
                      {network.walletType === 'web3' ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label={t('contract.nonce')} value={nonce} onChange={(e) => setNonce(e.target.value)} />
                          <Field label={t('contract.gas')} value={gasLimit} onChange={(e) => setGasLimit(e.target.value)} />
                        </div>
                      ) : (
                        <Field
                          label="feeLimit (TRX)"
                          hint={t('contract.feeLimitHint')}
                          value={feeLimit}
                          onChange={(e) => setFeeLimit(e.target.value)}
                        />
                      )}
                    </>
                  ) : null}

                  {tab === 'read' ? (
                    <Button
                      disabled={busy || !parsed || !fnSig || !contractAddress}
                      onClick={() =>
                        void run(async () => {
                          setReadResult(
                            await contractApi.read({
                              networkPk,
                              accountId: accountId || undefined,
                              contractAddress,
                              abiJson: parsed.abiJson,
                              signature: fnSig,
                              args,
                            }),
                          )
                        })
                      }
                    >
                      {t('contract.call')}
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        disabled={busy || !parsed || !fnSig || !contractAddress || !accountId}
                        onClick={() =>
                          void run(async () => {
                            setSigned(null)
                            setReceipt(null)
                            setPreview(
                              await contractApi.preview({
                                networkPk,
                                accountId,
                                contractAddress,
                                abiJson: parsed.abiJson,
                                signature: fnSig,
                                args,
                                value: value || undefined,
                                feeLevel,
                                customFeeRate: customFeeRate || undefined,
                                customPriorityFee: customPriorityFee || undefined,
                                gasLimit: gasLimit || undefined,
                                nonce: nonce ? Number(nonce) : undefined,
                                feeLimit: feeLimit || undefined,
                              }),
                            )
                          })
                        }
                      >
                        {t('common.preview')}
                      </Button>
                      <Button
                        disabled={busy || !preview}
                        onClick={() =>
                          void run(async () => {
                            if (!preview) return
                            setReceipt(null)
                            setSigned(await contractApi.sign(preview.draftId))
                            setPreview(null)
                          })
                        }
                      >
                        {t('txLab.signOnly')}
                      </Button>
                    </div>
                  )}

                  {preview ? (
                    <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                      <p>
                        {preview.signature} → {shorten(preview.contractAddress)}
                      </p>
                      <p>{t('transfer.feeText', { fee: preview.feeText })}</p>
                      {preview.value !== '0' ? <p>value {preview.value}</p> : null}
                      {preview.warnings.map((item) => (
                        <p key={item} className="text-honey-400">
                          {item}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {readResult ? (
                    <div className="space-y-2 rounded-lg bg-ink-900 px-3 py-2">
                      <p className="font-mono text-[11px] text-ink-400">{readResult.signature}</p>
                      {readResult.values.length === 0 ? (
                        <p className="text-xs text-ink-500">{t('contract.noReturn')}</p>
                      ) : (
                        readResult.values.map((item) => (
                          <p key={`${item.name}-${item.type}`} className="break-all font-mono text-[11px] text-ink-300">
                            {item.name} : {item.type} = {item.value}
                          </p>
                        ))
                      )}
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => void copy('read', JSON.stringify(readResult, null, 2))}
                      >
                        {copied === 'read' ? t('common.copied') : t('contract.copyResult')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </>
          ) : null}

          {signed ? (
            <Card title={t('txLab.signed')}>
              <div className="space-y-3">
                <p className="text-xs text-ink-500">
                  {signed.signature} · Tx Hash {shorten(signed.txid, 10, 8)}
                </p>
                <pre className="sensitive max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-900 px-3 py-2 font-mono text-[11px] text-ink-300">
                  {signed.raw}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy('raw', signed.raw)}>
                    {copied === 'raw' ? t('common.copied') : t('txLab.copyRaw')}
                  </Button>
                  <Button
                    disabled={busy || Boolean(receipt)}
                    onClick={() =>
                      void run(async () => {
                        setReceipt(
                          await txLabApi.broadcast({
                            networkPk: signed.networkPk,
                            raw: signed.raw,
                            accountId: signed.accountId,
                            from: signed.from,
                            to: signed.contractAddress,
                            amount: signed.value,
                            symbol: signed.signature,
                            fee: signed.feeText,
                          }),
                        )
                      })
                    }
                  >
                    {t('common.broadcast')}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          {receipt ? (
            <Card title={t('txLab.result')}>
              <div className="space-y-2">
                <p className="text-xs text-honey-400">
                  {receipt.transaction.status === 'confirmed'
                    ? t('transfer.confirmed')
                    : receipt.transaction.status === 'failed'
                      ? t('transfer.failed')
                      : t('transfer.pending')}
                </p>
                <p className="sensitive break-all font-mono text-[11px] text-ink-300">{receipt.txid}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy('txid', receipt.txid)}>
                    {copied === 'txid' ? t('common.copied') : t('txLab.copyHash')}
                  </Button>
                  {receipt.explorerUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(receipt.explorerUrl!, explorerTabTitle(receipt.explorerUrl!))}
                    >
                      {t('transfer.openExplorer')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

function paramLabel(input: AbiParamInfo, index: number): string {
  return `${input.name || `arg${index}`} (${input.type})`
}

function paramHint(input: AbiParamInfo, t: (key: MessageKey) => string): string | undefined {
  if (input.type === 'address') return t('abi.hintAddress')
  if (input.type.endsWith('[]') || input.type.startsWith('tuple')) return t('abi.hintJson')
  return undefined
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
