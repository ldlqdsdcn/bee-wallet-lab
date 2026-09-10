import { useEffect, useState } from 'react'
import type {
  DevConvertMode,
  DevConvertResult,
  DevHashResult,
  DevJsonResult,
} from '@shared/types'
import { devToolsApi } from '../lib/bridge'
import { Alert, Button, Card, Select, TextArea } from '../components/ui'
import { useT } from '../i18n'

type Tab = 'json' | 'hex' | 'hash'

const TABS: { id: Tab; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'hex', label: 'Hex' },
  { id: 'hash', label: 'Hash' },
]

const CONVERT_MODES: { value: DevConvertMode; label: string }[] = [
  { value: 'hex-to-utf8', label: 'Hex → UTF-8' },
  { value: 'utf8-to-hex', label: 'UTF-8 → Hex' },
  { value: 'hex-to-base64', label: 'Hex → Base64' },
  { value: 'base64-to-hex', label: 'Base64 → Hex' },
]

export default function DevToolsPage() {
  const t = useT()
  const [tab, setTab] = useState<Tab>('json')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const [jsonText, setJsonText] = useState('')
  const [jsonResult, setJsonResult] = useState<DevJsonResult | null>(null)
  const [expandAll, setExpandAll] = useState(true)

  const [hexText, setHexText] = useState('')
  const [hexMode, setHexMode] = useState<DevConvertMode>('hex-to-utf8')
  const [hexResult, setHexResult] = useState<DevConvertResult | null>(null)

  const [hashText, setHashText] = useState('')
  const [hashEncoding, setHashEncoding] = useState<'utf8' | 'hex'>('utf8')
  const [hashResult, setHashResult] = useState<DevHashResult | null>(null)

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

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(label)
    window.setTimeout(() => setCopied((prev) => (prev === label ? null : prev)), 1500)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('dev.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">{t('dev.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Button key={item.id} variant={tab === item.id ? 'primary' : 'ghost'} onClick={() => setTab(item.id)}>
            {item.label}
          </Button>
        ))}
      </div>

      <Alert>{error}</Alert>

      {tab === 'json' ? (
        <Card title="JSON Viewer">
          <div className="space-y-3">
            <TextArea
              label="JSON"
              className="sensitive min-h-36 font-mono text-xs"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !jsonText.trim()}
                onClick={() =>
                  void run(async () => {
                    const result = await devToolsApi.json(jsonText)
                    setJsonResult(result)
                    setJsonText(result.pretty)
                    setExpandAll(true)
                  })
                }
              >
                {t('dev.format')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !jsonText.trim()}
                onClick={() =>
                  void run(async () => {
                    const result = await devToolsApi.json(jsonText)
                    setJsonResult(result)
                    setJsonText(result.minified)
                  })
                }
              >
                {t('dev.minify')}
              </Button>
              {jsonResult ? (
                <>
                  <Button variant="ghost" onClick={() => setExpandAll(true)}>
                    {t('dev.expand')}
                  </Button>
                  <Button variant="ghost" onClick={() => setExpandAll(false)}>
                    {t('dev.collapse')}
                  </Button>
                  <Button variant="ghost" onClick={() => void copy('pretty', jsonResult.pretty)}>
                    {copied === 'pretty' ? t('common.copied') : t('dev.copyPretty')}
                  </Button>
                  <Button variant="ghost" onClick={() => void copy('min', jsonResult.minified)}>
                    {copied === 'min' ? t('common.copied') : t('dev.copyMin')}
                  </Button>
                </>
              ) : null}
            </div>
            {jsonResult ? (
              <div className="overflow-auto rounded-lg bg-ink-900 px-3 py-2 font-mono text-[12px] text-ink-300">
                <p className="mb-2 text-[11px] text-ink-500">
                  {jsonResult.kind}
                  {jsonResult.kind === 'object' && isRecord(jsonResult.parsed)
                    ? ` · ${Object.keys(jsonResult.parsed).length} keys`
                    : null}
                  {jsonResult.kind === 'array' && Array.isArray(jsonResult.parsed)
                    ? ` · ${jsonResult.parsed.length} items`
                    : null}
                </p>
                <JsonNode value={jsonResult.parsed} expandAll={expandAll} depth={0} />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab === 'hex' ? (
        <Card title="Hex Tools">
          <div className="space-y-3">
            <Select
              label={t('dev.convert')}
              value={hexMode}
              onChange={(e) => {
                setHexMode(e.target.value as DevConvertMode)
                setHexResult(null)
              }}
            >
              {CONVERT_MODES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
            <TextArea
              label={t('dev.input')}
              className="sensitive min-h-28 font-mono text-xs"
              hint={
                hexMode === 'utf8-to-hex'
                  ? t('dev.hintUtf8')
                  : hexMode === 'base64-to-hex'
                    ? t('dev.hintB64')
                    : t('dev.hintHex')
              }
              value={hexText}
              onChange={(e) => setHexText(e.target.value)}
            />
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setHexResult(await devToolsApi.convert({ mode: hexMode, value: hexText }))
                })
              }
            >
              {t('dev.convert')}
            </Button>
            {hexResult ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-500">{t('dev.bytes', { count: hexResult.bytes })}</p>
                <pre className="sensitive max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ink-900 px-3 py-2 font-mono text-[11px] text-ink-300">
                  {hexResult.output || t('common.empty')}
                </pre>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void copy('hex', hexResult.output)}>
                  {copied === 'hex' ? t('common.copied') : t('dev.copyResult')}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab === 'hash' ? (
        <Card title="Hash Tools">
          <div className="space-y-3">
            <Select label={t('dev.hashEncoding')} value={hashEncoding} onChange={(e) => setHashEncoding(e.target.value as 'utf8' | 'hex')}>
              <option value="utf8">{t('dev.utf8Text')}</option>
              <option value="hex">{t('dev.hexBytes')}</option>
            </Select>
            <TextArea
              label={t('dev.input')}
              className="sensitive min-h-28 font-mono text-xs"
              hint={hashEncoding === 'hex' ? t('dev.hashHintHex') : t('dev.hashHintUtf8')}
              value={hashText}
              onChange={(e) => setHashText(e.target.value)}
            />
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setHashResult(await devToolsApi.hash({ value: hashText, encoding: hashEncoding }))
                })
              }
            >
              {t('dev.compute')}
            </Button>
            {hashResult ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-500">{t('dev.bytes', { count: hashResult.bytes })}</p>
                {hashResult.hashes.map((item) => (
                  <div key={item.algo} className="rounded-lg bg-ink-900 px-3 py-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs text-ink-400">{item.label}</p>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => void copy(item.algo, item.hex)}
                      >
                        {copied === item.algo ? t('common.copied') : t('common.copy')}
                      </Button>
                    </div>
                    <p className="sensitive break-all font-mono text-[11px] text-ink-300">{item.hex}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function JsonNode({
  name,
  value,
  expandAll,
  depth,
}: {
  name?: string
  value: unknown
  expandAll: boolean
  depth: number
}) {
  const nested = Array.isArray(value) || isRecord(value)
  const [open, setOpen] = useState(depth === 0 || expandAll)

  useEffect(() => {
    setOpen(depth === 0 || expandAll)
  }, [expandAll, depth])

  const prefix = name != null ? <span className="text-honey-400">{JSON.stringify(name)}</span> : null

  if (!nested) {
    return (
      <div className="whitespace-pre-wrap break-all">
        {prefix}
        {prefix ? <span className="text-ink-600">: </span> : null}
        <span className={valueClass(value)}>{literal(value)}</span>
      </div>
    )
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)
  const bracket = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  const summary = Array.isArray(value) ? `${value.length}` : `${entries.length}`

  return (
    <div>
      <button type="button" className="text-left text-ink-200 hover:text-honey-400" onClick={() => setOpen((v) => !v)}>
        {prefix}
        {prefix ? <span className="text-ink-600">: </span> : null}
        <span className="text-ink-500">{open ? '▾' : '▸'}</span>{' '}
        <span className="text-ink-400">
          {bracket[0]}
          {open ? '' : ` ${summary} ${bracket[1]}`}
        </span>
      </button>
      {open ? (
        <div className="ml-4 border-l border-ink-700 pl-3">
          {entries.map(([key, item]) => (
            <JsonNode key={key} name={key} value={item} expandAll={expandAll} depth={depth + 1} />
          ))}
          <div className="text-ink-400">{bracket[1]}</div>
        </div>
      ) : null}
    </div>
  )
}

function literal(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return 'null'
}

function valueClass(value: unknown): string {
  if (typeof value === 'string') return 'text-honey-300'
  if (typeof value === 'number') return 'text-sky-300'
  if (typeof value === 'boolean') return 'text-ink-200'
  return 'text-ink-500'
}
