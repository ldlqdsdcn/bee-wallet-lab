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

function isRead(fn: AbiFunctionInfo): boolean {
  return fn.stateMutability === 'view' || fn.stateMutability === 'pure'
}

export default function ContractPage() {
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
        <h1 className="text-lg font-semibold text-ink-200">合约交互</h1>
        <p className="mt-1 text-xs text-ink-500">
          {network ? `${network.networkName} · ${walletTypeLabel(network.walletType)}` : '请先在侧栏选择网络'}
          {' · 读取 view/pure，写入后可只签名或再广播'}
        </p>
      </div>

      <Alert>{error}</Alert>

      {!supported ? (
        <Card title="当前网络">
          <p className="text-sm text-ink-400">合约交互只支持 EVM 和 TRON，请在侧栏切换网络。</p>
        </Card>
      ) : (
        <>
          <Card title="合约">
            <div className="space-y-3">
              <Select label="调用账户" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {filteredAccounts.length === 0 ? (
                  <option value="">当前网络没有可用账户</option>
                ) : (
                  filteredAccounts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label || item.walletType} · {shorten(item.address, 8, 6)}
                    </option>
                  ))
                )}
              </Select>
              <Field
                label="合约地址"
                className="sensitive"
                value={contractAddress}
                placeholder={network.walletType === 'tron' ? 'T… 或 0x…' : '0x…'}
                onChange={(e) => setContractAddress(e.target.value)}
              />
              {saved.length > 0 ? (
                <Select
                  label="已保存 ABI"
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
                  <option value="">选择已导入的 ABI</option>
                  {saved.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.functionCount} 函数
                    </option>
                  ))}
                </Select>
              ) : null}
              <TextArea
                label="ABI JSON"
                className="sensitive min-h-28 font-mono text-xs"
                hint="可从「ABI 工具」保存后在这里选用，或直接粘贴"
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
                  解析 ABI
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
                  载入 ERC-20
                </Button>
              </div>
            </div>
          </Card>

          {parsed ? (
            <>
              <div className="flex gap-2">
                <Button variant={tab === 'read' ? 'primary' : 'ghost'} onClick={() => setTab('read')}>
                  读取
                </Button>
                <Button variant={tab === 'write' ? 'primary' : 'ghost'} onClick={() => setTab('write')}>
                  写入
                </Button>
              </div>

              <Card title={tab === 'read' ? 'Read Contract' : 'Write Contract'}>
                <div className="space-y-3">
                  <Select label="函数" value={fnSig} onChange={(e) => setFnSig(e.target.value)}>
                    {functions.length === 0 ? (
                      <option value="">{tab === 'read' ? '没有 view / pure 函数' : '没有可写函数'}</option>
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
                      hint={paramHint(input)}
                      value={args[index] ?? ''}
                      onChange={(e) => setArgs((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))}
                    />
                  ))}

                  {tab === 'write' && selectedFn?.stateMutability === 'payable' ? (
                    <Field
                      label={`附带 ${network.coinEasy || (network.walletType === 'tron' ? 'TRX' : 'ETH')}`}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  ) : null}

                  {tab === 'write' ? (
                    <>
                      <Select label="费率" value={feeLevel} onChange={(e) => setFeeLevel(e.target.value as FeeLevel)}>
                        <option value="low">慢</option>
                        <option value="medium">标准</option>
                        <option value="high">快</option>
                        <option value="custom">自定义</option>
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
                          <Field label="Nonce（可空）" value={nonce} onChange={(e) => setNonce(e.target.value)} />
                          <Field label="Gas Limit（可空）" value={gasLimit} onChange={(e) => setGasLimit(e.target.value)} />
                        </div>
                      ) : (
                        <Field
                          label="feeLimit (TRX)"
                          hint="默认 40"
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
                      调用
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
                        预览
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
                        签名（不广播）
                      </Button>
                    </div>
                  )}

                  {preview ? (
                    <div className="space-y-1 rounded-lg bg-ink-900 px-3 py-2 text-xs text-ink-400">
                      <p>
                        {preview.signature} → {shorten(preview.contractAddress)}
                      </p>
                      <p>手续费 {preview.feeText}</p>
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
                        <p className="text-xs text-ink-500">没有返回值</p>
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
                        {copied === 'read' ? '已复制' : '复制结果'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </>
          ) : null}

          {signed ? (
            <Card title="已签名，尚未广播">
              <div className="space-y-3">
                <p className="text-xs text-ink-500">
                  {signed.signature} · Tx Hash {shorten(signed.txid, 10, 8)}
                </p>
                <pre className="sensitive max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-900 px-3 py-2 font-mono text-[11px] text-ink-300">
                  {signed.raw}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy('raw', signed.raw)}>
                    {copied === 'raw' ? '已复制' : '复制 Raw'}
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
                    广播
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          {receipt ? (
            <Card title="广播结果">
              <div className="space-y-2">
                <p className="text-xs text-honey-400">
                  {receipt.transaction.status === 'confirmed'
                    ? '交易已确认'
                    : receipt.transaction.status === 'failed'
                      ? '交易失败'
                      : '已广播，正在确认…'}
                </p>
                <p className="sensitive break-all font-mono text-[11px] text-ink-300">{receipt.txid}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy('txid', receipt.txid)}>
                    {copied === 'txid' ? '已复制' : '复制 Tx Hash'}
                  </Button>
                  {receipt.explorerUrl ? (
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => openExplorer(receipt.explorerUrl!, explorerTabTitle(receipt.explorerUrl!))}
                    >
                      在浏览器中查看
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

function paramHint(input: AbiParamInfo): string | undefined {
  if (input.type === 'address') return '0x 地址，TRON 也可用 T 开头地址'
  if (input.type.endsWith('[]') || input.type.startsWith('tuple')) return '请填 JSON'
  return undefined
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
