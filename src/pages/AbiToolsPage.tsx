import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AbiContractRecord,
  AbiDecodeCallResult,
  AbiDecodeEventResult,
  AbiDecodeResultOutput,
  AbiEncodeResult,
  AbiFunctionInfo,
  AbiParamInfo,
  AbiParsed,
} from '@shared/types'
import { abiApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select, TextArea } from '../components/ui'

type ToolTab = 'encode' | 'decodeCall' | 'decodeResult' | 'decodeEvent'

const TABS: { id: ToolTab; label: string }[] = [
  { id: 'encode', label: '编码' },
  { id: 'decodeCall', label: '解码 calldata' },
  { id: 'decodeResult', label: '解码返回值' },
  { id: 'decodeEvent', label: '解码 Event' },
]

export default function AbiToolsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [abiText, setAbiText] = useState('')
  const [name, setName] = useState('')
  const [contractAddress, setContractAddress] = useState('')
  const [parsed, setParsed] = useState<AbiParsed | null>(null)
  const [saved, setSaved] = useState<AbiContractRecord[]>([])
  const [savedId, setSavedId] = useState('')
  const [fnSig, setFnSig] = useState('')
  const [eventSig, setEventSig] = useState('')
  const [tab, setTab] = useState<ToolTab>('encode')
  const [args, setArgs] = useState<string[]>([])
  const [calldata, setCalldata] = useState('')
  const [resultHex, setResultHex] = useState('')
  const [eventData, setEventData] = useState('')
  const [eventTopics, setEventTopics] = useState('')
  const [encoded, setEncoded] = useState<AbiEncodeResult | null>(null)
  const [decodedCall, setDecodedCall] = useState<AbiDecodeCallResult | null>(null)
  const [decodedResult, setDecodedResult] = useState<AbiDecodeResultOutput | null>(null)
  const [decodedEvent, setDecodedEvent] = useState<AbiDecodeEventResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const selectedFn = parsed?.functions.find((item) => item.signature === fnSig) ?? null
  const selectedEvent = parsed?.events.find((item) => item.signature === eventSig) ?? null

  useEffect(() => {
    void abiApi.list().then(setSaved).catch(() => undefined)
  }, [])

  useEffect(() => {
    const inputs = parsed?.functions.find((item) => item.signature === fnSig)?.inputs ?? []
    setArgs(inputs.map(() => ''))
    setEncoded(null)
    setDecodedResult(null)
  }, [fnSig, parsed])

  const functionOptions = useMemo(() => parsed?.functions ?? [], [parsed])
  const eventOptions = useMemo(() => parsed?.events ?? [], [parsed])

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

  const applyParsed = (next: AbiParsed, keepId?: string) => {
    setParsed(next)
    setName(next.name)
    setAbiText(prettyJson(next.abiJson))
    if (next.contractAddress) setContractAddress(next.contractAddress)
    setFnSig(next.functions[0]?.signature ?? '')
    setEventSig(next.events[0]?.signature ?? '')
    setEncoded(null)
    setDecodedCall(null)
    setDecodedResult(null)
    setDecodedEvent(null)
    if (keepId !== undefined) setSavedId(keepId)
  }

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied((prev) => (prev === label ? null : prev)), 1500)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">ABI 工具</h1>
        <p className="mt-1 text-xs text-ink-500">
          导入 EVM / TRON ABI，列出函数与事件，编码 calldata，解码调用、返回值和 Event Log
        </p>
      </div>

      <Alert>{error}</Alert>

      <Card title="ABI 导入">
        <div className="space-y-3">
          {saved.length > 0 ? (
            <Select
              label="已保存"
              value={savedId}
              onChange={(e) => {
                const id = e.target.value
                setSavedId(id)
                const item = saved.find((row) => row.id === id)
                if (!item) return
                void run(async () => {
                  applyParsed(await abiApi.parse(item.abiJson, item.name, item.contractAddress ?? undefined), item.id)
                  setContractAddress(item.contractAddress ?? '')
                })
              }}
            >
              <option value="">选择已导入的 ABI</option>
              {saved.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.functionCount} 函数 / {item.eventCount} 事件
                </option>
              ))}
            </Select>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="名称" value={name} placeholder="例如 ERC-20" onChange={(e) => setName(e.target.value)} />
            <Field
              label="合约地址（可选）"
              className="sensitive"
              value={contractAddress}
              placeholder="0x… 或 T…"
              onChange={(e) => setContractAddress(e.target.value)}
            />
          </div>
          <TextArea
            label="ABI JSON"
            className="sensitive min-h-36 font-mono text-xs"
            hint="粘贴 ABI 数组，或 Hardhat / Truffle 编译产物"
            value={abiText}
            onChange={(e) => setAbiText(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void run(async () => {
                const text = await file.text()
                setAbiText(text)
                applyParsed(await abiApi.parse(text, name || file.name.replace(/\.json$/i, ''), contractAddress || undefined))
              })
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !abiText.trim()}
              onClick={() =>
                void run(async () => {
                  applyParsed(await abiApi.parse(abiText, name || undefined, contractAddress || undefined), savedId)
                })
              }
            >
              解析
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              导入 JSON
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const preset = await abiApi.preset('erc20')
                  setName(preset.name)
                  setAbiText(preset.abiJson)
                  applyParsed(await abiApi.parse(preset.abiJson, preset.name))
                })
              }
            >
              载入 ERC-20
            </Button>
            <Button
              variant="ghost"
              disabled={busy || !parsed}
              onClick={() =>
                void run(async () => {
                  if (!parsed) return
                  const record = await abiApi.upsert({
                    id: savedId || undefined,
                    name: name || parsed.name,
                    contractAddress: contractAddress || null,
                    abiJson: parsed.abiJson,
                  })
                  const list = await abiApi.list()
                  setSaved(list)
                  setSavedId(record.id)
                })
              }
            >
              保存到库
            </Button>
            {savedId ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await abiApi.remove(savedId)
                    setSaved(await abiApi.list())
                    setSavedId('')
                  })
                }
              >
                从库删除
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {parsed ? (
        <>
          <Card title="函数与事件">
            <div className="grid gap-4 md:grid-cols-2">
              <ItemList
                title={`函数 ${functionOptions.length}`}
                empty="没有函数"
                items={functionOptions.map((item) => ({
                  key: item.signature,
                  active: item.signature === fnSig,
                  title: item.signature,
                  meta: `${mutabilityLabel(item.stateMutability)} · ${item.selector}`,
                  onClick: () => {
                    setFnSig(item.signature)
                    setTab((current) => (current === 'decodeEvent' ? 'encode' : current))
                  },
                }))}
              />
              <ItemList
                title={`事件 ${eventOptions.length}`}
                empty="没有事件"
                items={eventOptions.map((item) => ({
                  key: item.signature,
                  active: item.signature === eventSig,
                  title: item.signature,
                  meta: item.anonymous ? 'anonymous' : item.topic0 ?? '',
                  onClick: () => {
                    setEventSig(item.signature)
                    setTab('decodeEvent')
                  },
                }))}
              />
            </div>
            {parsed.warnings.map((item) => (
              <p key={item} className="mt-3 text-xs text-honey-400">
                {item}
              </p>
            ))}
          </Card>

          <div className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <Button key={item.id} variant={tab === item.id ? 'primary' : 'ghost'} onClick={() => setTab(item.id)}>
                {item.label}
              </Button>
            ))}
          </div>

          {tab === 'encode' ? (
            <EncodeCard
              fn={selectedFn}
              args={args}
              busy={busy}
              encoded={encoded}
              copied={copied}
              onArg={(index, value) => setArgs((prev) => prev.map((item, i) => (i === index ? value : item)))}
              onCopy={copy}
              onEncode={() =>
                void run(async () => {
                  if (!parsed || !selectedFn) return
                  const result = await abiApi.encode(parsed.abiJson, selectedFn.signature, args)
                  setEncoded(result)
                  setCalldata(result.calldata)
                })
              }
            />
          ) : null}

          {tab === 'decodeCall' ? (
            <Card title="解码 calldata">
              <div className="space-y-3">
                <TextArea
                  label="Calldata"
                  className="sensitive min-h-24 font-mono text-xs"
                  hint="含 4 字节 selector 的十六进制"
                  value={calldata}
                  onChange={(e) => setCalldata(e.target.value)}
                />
                <Button
                  disabled={busy || !parsed || !calldata.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (!parsed) return
                      const result = await abiApi.decodeCall(parsed.abiJson, calldata)
                      setDecodedCall(result)
                      setFnSig(result.signature)
                    })
                  }
                >
                  解码
                </Button>
                {decodedCall ? (
                  <DecodedBlock
                    title={`${decodedCall.signature} · ${decodedCall.selector}`}
                    values={decodedCall.args}
                    copied={copied}
                    onCopy={copy}
                    copyValue={JSON.stringify(decodedCall, null, 2)}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}

          {tab === 'decodeResult' ? (
            <Card title="解码返回值">
              <div className="space-y-3">
                <p className="text-xs text-ink-500">
                  {selectedFn ? `当前函数 ${selectedFn.signature}` : '请先在函数列表里选一个有返回值的函数'}
                </p>
                <TextArea
                  label="返回值 Hex"
                  className="sensitive min-h-24 font-mono text-xs"
                  hint="eth_call / 交易 output 的十六进制"
                  value={resultHex}
                  onChange={(e) => setResultHex(e.target.value)}
                />
                <Button
                  disabled={busy || !parsed || !selectedFn || !resultHex.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (!parsed || !selectedFn) return
                      setDecodedResult(await abiApi.decodeResult(parsed.abiJson, selectedFn.signature, resultHex))
                    })
                  }
                >
                  解码
                </Button>
                {decodedResult ? (
                  <DecodedBlock
                    title={decodedResult.signature}
                    values={decodedResult.values}
                    copied={copied}
                    onCopy={copy}
                    copyValue={JSON.stringify(decodedResult, null, 2)}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}

          {tab === 'decodeEvent' ? (
            <Card title="解码 Event Log">
              <div className="space-y-3">
                <p className="text-xs text-ink-500">
                  {selectedEvent
                    ? `${selectedEvent.signature}${selectedEvent.topic0 ? ` · ${selectedEvent.topic0}` : ' · anonymous'}`
                    : '从事件列表选择，或直接粘贴 topics / data 自动匹配'}
                </p>
                <TextArea
                  label="Topics"
                  className="sensitive min-h-24 font-mono text-xs"
                  hint="JSON 数组，或一行一个 topic"
                  value={eventTopics}
                  onChange={(e) => setEventTopics(e.target.value)}
                />
                <TextArea
                  label="Data"
                  className="sensitive min-h-24 font-mono text-xs"
                  hint="非 indexed 参数的十六进制，没有可留空"
                  value={eventData}
                  onChange={(e) => setEventData(e.target.value)}
                />
                <Button
                  disabled={busy || !parsed || !eventTopics.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (!parsed) return
                      const result = await abiApi.decodeEvent(parsed.abiJson, eventData, eventTopics)
                      setDecodedEvent(result)
                      setEventSig(result.signature)
                    })
                  }
                >
                  解码
                </Button>
                {decodedEvent ? (
                  <DecodedBlock
                    title={`${decodedEvent.signature}${decodedEvent.topic0 ? ` · ${decodedEvent.topic0}` : ''}`}
                    values={decodedEvent.args}
                    copied={copied}
                    onCopy={copy}
                    copyValue={JSON.stringify(decodedEvent, null, 2)}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function EncodeCard({
  fn,
  args,
  busy,
  encoded,
  copied,
  onArg,
  onEncode,
  onCopy,
}: {
  fn: AbiFunctionInfo | null
  args: string[]
  busy: boolean
  encoded: AbiEncodeResult | null
  copied: string | null
  onArg: (index: number, value: string) => void
  onEncode: () => void
  onCopy: (label: string, value: string) => void
}) {
  return (
    <Card title="ABI Encode">
      <div className="space-y-3">
        {fn ? (
          <>
            <p className="text-xs text-ink-500">
              {fn.signature} · {fn.selector}
            </p>
            {fn.inputs.length === 0 ? (
              <p className="text-xs text-ink-500">该函数没有参数</p>
            ) : (
              fn.inputs.map((input, index) => (
                <Field
                  key={`${fn.signature}-${index}`}
                  label={paramLabel(input, index)}
                  className="sensitive font-mono"
                  hint={paramHint(input)}
                  value={args[index] ?? ''}
                  onChange={(e) => onArg(index, e.target.value)}
                />
              ))
            )}
            <Button disabled={busy} onClick={onEncode}>
              编码
            </Button>
          </>
        ) : (
          <p className="text-sm text-ink-400">先解析 ABI 并选择函数</p>
        )}
        {encoded ? (
          <div className="space-y-2">
            <pre className="sensitive max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-900 px-3 py-2 font-mono text-[11px] text-ink-300">
              {encoded.calldata}
            </pre>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void onCopy('calldata', encoded.calldata)}>
              {copied === 'calldata' ? '已复制' : '复制 calldata'}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function ItemList({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: { key: string; active: boolean; title: string; meta: string; onClick: () => void }[]
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-400">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-ink-500">{empty}</p>
      ) : (
        <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-ink-700 p-1">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={`block w-full rounded-md px-2 py-1.5 text-left ${
                item.active ? 'bg-ink-700 text-honey-400' : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              <span className="block break-all font-mono text-[11px]">{item.title}</span>
              <span className="block break-all font-mono text-[10px] text-ink-500">{item.meta}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DecodedBlock({
  title,
  values,
  copied,
  onCopy,
  copyValue,
}: {
  title: string
  values: { name: string; type: string; indexed?: boolean; value: string }[]
  copied: string | null
  onCopy: (label: string, value: string) => void
  copyValue: string
}) {
  return (
    <div className="space-y-2 rounded-lg bg-ink-900 px-3 py-2">
      <p className="break-all font-mono text-[11px] text-ink-400">{title}</p>
      {values.length === 0 ? (
        <p className="text-xs text-ink-500">没有参数</p>
      ) : (
        values.map((item) => (
          <p key={`${item.name}-${item.type}`} className="break-all font-mono text-[11px] text-ink-300">
            {item.name}
            {item.indexed ? ' (indexed)' : ''} : {item.type} = {item.value}
          </p>
        ))
      )}
      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void onCopy('decoded', copyValue)}>
        {copied === 'decoded' ? '已复制' : '复制 JSON'}
      </Button>
    </div>
  )
}

function paramLabel(input: AbiParamInfo, index: number): string {
  return `${input.name || `arg${index}`} (${input.type}${input.indexed ? ', indexed' : ''})`
}

function paramHint(input: AbiParamInfo): string | undefined {
  if (input.type === 'address') return '0x 地址，TRON 也可用 T 开头地址'
  if (input.type.endsWith('[]') || input.type.startsWith('tuple')) return '请填 JSON'
  return undefined
}

function mutabilityLabel(value: string): string {
  if (value === 'view' || value === 'pure') return '读'
  if (value === 'payable') return 'payable'
  return '写'
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
