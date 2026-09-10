/**
 * EVM ABI 编解码。TRON 地址会先转成 0x 再交给 viem。
 */
import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionData,
  parseAbi,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from 'viem'
import type {
  AbiDecodeCallResult,
  AbiDecodeEventResult,
  AbiDecodeResultOutput,
  AbiDecodedValue,
  AbiEncodeResult,
  AbiEventInfo,
  AbiFunctionInfo,
  AbiParamInfo,
  AbiParsed,
} from '@shared/types'
import { asRecord, asString } from '../backend/list'
import { isEvmAddress, toChecksumAddress } from '../derive/evm'
import { isTronAddress, tronAddressToEvmAddress } from '../derive/tron'

const MAX_ABI_CHARS = 1_000_000

export function extractAbi(raw: string): { abi: Abi; name: string | null } {
  const text = raw.trim()
  if (!text) throw new Error('ABI 不能为空')
  if (text.length > MAX_ABI_CHARS) throw new Error('ABI JSON 过大')

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('ABI 不是合法 JSON')
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && typeof parsed[0] === 'string') {
      return { abi: parseAbi(parsed as readonly string[]), name: null }
    }
    return { abi: parsed as Abi, name: null }
  }

  const record = asRecord(parsed)
  if (!record) throw new Error('ABI JSON 无效')
  if (Array.isArray(record.abi)) {
    return { abi: record.abi as Abi, name: asString(record.contractName) || null }
  }
  const output = asRecord(record.output)
  if (output && Array.isArray(output.abi)) {
    return { abi: output.abi as Abi, name: asString(record.contractName) || null }
  }
  throw new Error('未找到 ABI 数组，请粘贴 ABI JSON 或编译产物')
}

export function parseAbiDocument(raw: string, nameHint?: string, contractAddress?: string | null): AbiParsed {
  const extracted = extractAbi(raw)
  const functions: AbiFunctionInfo[] = []
  const events: AbiEventInfo[] = []
  const warnings: string[] = []

  for (const item of extracted.abi) {
    if (!item || typeof item !== 'object') continue
    if (item.type === 'function') {
      const fn = item as AbiFunction
      try {
        functions.push(toFunctionInfo(fn))
      } catch (err) {
        warnings.push(`无法解析函数 ${fn.name || '?'}: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else if (item.type === 'event') {
      const ev = item as AbiEvent
      try {
        events.push(toEventInfo(ev))
      } catch (err) {
        warnings.push(`无法解析事件 ${ev.name || '?'}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  functions.sort((a, b) => a.signature.localeCompare(b.signature))
  events.sort((a, b) => a.signature.localeCompare(b.signature))

  return {
    name: nameHint?.trim() || extracted.name || '未命名合约',
    contractAddress: contractAddress?.trim() || null,
    abiJson: JSON.stringify(extracted.abi),
    functions,
    events,
    warnings,
  }
}

export function isReadFunction(mutability: string): boolean {
  return mutability === 'view' || mutability === 'pure'
}

/** TRON trigger* 的 parameter 是去掉 4 字节 selector 后的 ABI 编码。 */
export function abiCalldataToTronParameter(calldata: string): string {
  const hex = requireHex(calldata, 'calldata')
  if (hex.length < 10) throw new Error('calldata 太短')
  return hex.slice(10)
}

export function encodeAbiCall(abiJson: string, signature: string, args: string[]): AbiEncodeResult {
  const { abi } = extractAbi(abiJson)
  const fn = requireFunction(abi, signature)
  const values = fn.inputs.map((input, index) => coerceArg(input, args[index] ?? ''))
  const calldata = encodeFunctionData({ abi: [fn], functionName: fn.name, args: values })
  return {
    signature: functionSignature(fn),
    selector: toFunctionSelector(fn),
    calldata,
  }
}

export function decodeAbiCalldata(abiJson: string, data: string): AbiDecodeCallResult {
  const { abi } = extractAbi(abiJson)
  const hex = requireHex(data, 'calldata')
  const decoded = decodeFunctionData({ abi, data: hex })
  const args = decoded.args ?? []
  const fn = findFunctionByNameAndArgs(abi, decoded.functionName, args.length)
  const signature = functionSignature(fn)
  return {
    name: fn.name,
    signature,
    selector: hex.slice(0, 10),
    args: zipDecoded(fn.inputs, args),
  }
}

export function decodeAbiReturn(abiJson: string, signature: string, data: string): AbiDecodeResultOutput {
  const { abi } = extractAbi(abiJson)
  const fn = requireFunction(abi, signature)
  const hex = requireHex(data, '返回值')
  const decoded = decodeFunctionResult({ abi: [fn], functionName: fn.name, data: hex })
  const values = fn.outputs.length <= 1 ? [decoded] : asArray(decoded)
  return {
    signature: functionSignature(fn),
    values: zipDecoded(fn.outputs, values),
  }
}

export function decodeAbiEventLog(abiJson: string, data: string, topicsRaw: string): AbiDecodeEventResult {
  const { abi } = extractAbi(abiJson)
  const topics = parseTopics(topicsRaw)
  const hex = data.trim() ? requireHex(data, 'data') : '0x'
  const decoded = decodeEventLog({
    abi,
    data: hex,
    topics: topics as [`0x${string}`, ...`0x${string}`[]] | [],
    strict: true,
  })
  if (!decoded.eventName) throw new Error('无法识别 Event')
  const ev = requireEvent(abi, decoded.eventName, decoded.args)
  return {
    name: ev.name,
    signature: eventSignature(ev),
    topic0: ev.anonymous ? null : toEventSelector(ev),
    args: zipEventArgs(ev, decoded.args),
  }
}

export function toFunctionInfo(fn: AbiFunction): AbiFunctionInfo {
  return {
    name: fn.name,
    signature: functionSignature(fn),
    selector: toFunctionSelector(fn),
    stateMutability: fn.stateMutability ?? 'nonpayable',
    inputs: fn.inputs.map(toParamInfo),
    outputs: (fn.outputs ?? []).map(toParamInfo),
  }
}

export function toEventInfo(ev: AbiEvent): AbiEventInfo {
  return {
    name: ev.name,
    signature: eventSignature(ev),
    topic0: ev.anonymous ? null : toEventSelector(ev),
    anonymous: Boolean(ev.anonymous),
    inputs: ev.inputs.map((input) => ({ ...toParamInfo(input), indexed: Boolean(input.indexed) })),
  }
}

function toParamInfo(input: AbiParameter): AbiParamInfo {
  const components = 'components' in input && Array.isArray(input.components)
    ? input.components.map(toParamInfo)
    : undefined
  return {
    name: input.name || '',
    type: input.type,
    components,
  }
}

function functionSignature(fn: AbiFunction): string {
  return `${fn.name}(${fn.inputs.map(formatType).join(',')})`
}

function eventSignature(ev: AbiEvent): string {
  return `${ev.name}(${ev.inputs.map(formatType).join(',')})`
}

function formatType(input: AbiParameter): string {
  if (input.type.startsWith('tuple')) {
    const inner = ('components' in input && input.components ? input.components : []).map(formatType).join(',')
    return `(${inner})${input.type.slice('tuple'.length)}`
  }
  return input.type
}

function requireFunction(abi: Abi, signature: string): AbiFunction {
  const wanted = signature.trim()
  const matches = abi.filter((item): item is AbiFunction => {
    if (item.type !== 'function') return false
    return functionSignature(item) === wanted || item.name === wanted
  })
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    const exact = matches.find((item) => functionSignature(item) === wanted)
    if (exact) return exact
    throw new Error(`函数 ${wanted} 有重载，请使用完整签名`)
  }
  throw new Error(`ABI 中没有函数 ${wanted}`)
}

function requireEvent(abi: Abi, name: string, args: unknown): AbiEvent {
  const matches = abi.filter((item): item is AbiEvent => item.type === 'event' && item.name === name)
  if (matches.length === 1) return matches[0]
  const count = decodedArgCount(args)
  const byCount = matches.find((item) => item.inputs.length === count)
  if (byCount) return byCount
  if (matches[0]) return matches[0]
  throw new Error(`ABI 中没有事件 ${name}`)
}

function findFunctionByNameAndArgs(abi: Abi, name: string, argCount: number): AbiFunction {
  const matches = abi.filter((item): item is AbiFunction => item.type === 'function' && item.name === name)
  if (matches.length === 1) return matches[0]
  const byCount = matches.find((item) => item.inputs.length === argCount)
  if (byCount) return byCount
  if (matches[0]) return matches[0]
  throw new Error(`ABI 中没有函数 ${name}`)
}

function zipDecoded(params: readonly AbiParameter[], values: readonly unknown[]): AbiDecodedValue[] {
  return params.map((param, index) => ({
    name: param.name || `#${index}`,
    type: formatType(param),
    value: stringifyValue(values[index]),
  }))
}

function zipEventArgs(ev: AbiEvent, args: unknown): AbiDecodedValue[] {
  const record = asRecord(args)
  return ev.inputs.map((input, index) => {
    const value = record && input.name && input.name in record ? record[input.name] : Array.isArray(args) ? args[index] : undefined
    return {
      name: input.name || `#${index}`,
      type: formatType(input),
      indexed: Boolean(input.indexed),
      value: stringifyValue(value),
    }
  })
}

function decodedArgCount(args: unknown): number {
  if (Array.isArray(args)) return args.length
  const record = asRecord(args)
  if (!record) return 0
  return Object.keys(record).filter((key) => !/^\d+$/.test(key)).length || Object.keys(record).length
}

export function coerceArg(param: AbiParameter, raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed && param.type !== 'string') throw new Error(`参数 ${param.name || param.type} 不能为空`)
  if (param.type === 'tuple' || param.type.startsWith('tuple[')) {
    return coerceValue(param, parseJsonArg(trimmed, param))
  }
  if (param.type.endsWith('[]') || /\[\d+\]$/.test(param.type)) {
    return coerceValue(param, parseJsonArg(trimmed, param))
  }
  if (looksLikeJson(trimmed) && (param.type === 'string' || param.type.startsWith('bytes'))) {
    try {
      return coerceValue(param, JSON.parse(trimmed))
    } catch {
      return coerceValue(param, trimmed)
    }
  }
  return coerceValue(param, trimmed)
}

function coerceValue(param: AbiParameter, value: unknown): unknown {
  const type = param.type
  if (type === 'tuple') {
    const components = 'components' in param && param.components ? param.components : []
    if (Array.isArray(value)) {
      if (value.length !== components.length) throw new Error(`tuple ${param.name || ''} 元素数量不匹配`)
      return value.map((item, index) => coerceValue(components[index], item))
    }
    const record = asRecord(value)
    if (!record) throw new Error(`tuple ${param.name || ''} 需要 JSON 对象或数组`)
    return components.map((item) => coerceValue(item, item.name ? record[item.name] : undefined))
  }
  const arrayMatch = type.match(/^(.*)\[(\d*)\]$/)
  if (arrayMatch) {
    if (!Array.isArray(value)) throw new Error(`${type} 需要 JSON 数组`)
    const inner: AbiParameter = {
      ...param,
      type: arrayMatch[1],
      name: param.name,
    }
    if (arrayMatch[2] && value.length !== Number(arrayMatch[2])) {
      throw new Error(`${type} 长度必须为 ${arrayMatch[2]}`)
    }
    return value.map((item) => coerceValue(inner, item))
  }
  if (type === 'address') return coerceAddress(value)
  if (type === 'bool') return coerceBool(value)
  if (type.startsWith('uint') || type.startsWith('int')) return coerceInteger(value, param.name || type)
  if (type === 'string') return coerceString(value)
  if (type === 'bytes' || /^bytes\d+$/.test(type)) return coerceBytes(value, type)
  return value
}

function coerceAddress(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '')
  if (isTronAddress(text)) return tronAddressToEvmAddress(text)
  if (isEvmAddress(text)) return toChecksumAddress(text)
  throw new Error(`地址不合法：${text}`)
}

function coerceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0') return false
  throw new Error(`布尔值不合法：${value}`)
}

function coerceInteger(value: unknown, label: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) return BigInt(value)
  const text = String(value).trim()
  if (!text) throw new Error(`${label} 不能为空`)
  try {
    return BigInt(text)
  } catch {
    throw new Error(`${label} 不是整数`)
  }
}

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  return String(value)
}

function coerceBytes(value: unknown, type: string): Hex {
  const text = typeof value === 'string' ? value.trim() : bytesToPrefixed(value)
  const hex = requireHex(text, type)
  if (/^bytes\d+$/.test(type)) {
    const size = Number(type.slice(5))
    const body = hex.slice(2)
    if (body.length !== size * 2) throw new Error(`${type} 需要 ${size} 字节`)
  }
  return hex
}

function bytesToPrefixed(value: unknown): string {
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value, (item) => item.toString(16).padStart(2, '0')).join('')}`
  }
  return String(value ?? '')
}

function parseJsonArg(raw: string, param: AbiParameter): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`参数 ${param.name || param.type} 需要 JSON`)
  }
}

function looksLikeJson(value: string): boolean {
  const c = value[0]
  return c === '"' || c === '{' || c === '['
}

export function parseTopics(raw: string): Hex[] {
  const text = raw.trim()
  if (!text) return []
  if (text.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('topics 不是合法 JSON 数组')
    }
    if (!Array.isArray(parsed)) throw new Error('topics 必须是数组')
    return parsed.map((item, index) => requireHex(String(item), `topic[${index}]`))
  }
  return text
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => requireHex(item, `topic[${index}]`))
}

export function requireHex(value: string, label: string): Hex {
  const hex = value.trim().replace(/\s+/g, '')
  const prefixed = hex.startsWith('0x') || hex.startsWith('0X') ? hex : `0x${hex}`
  if (prefixed !== '0x' && !/^0x[0-9a-fA-F]*$/.test(prefixed)) throw new Error(`${label} 必须是十六进制`)
  if (prefixed !== '0x' && prefixed.length % 2 !== 0) throw new Error(`${label} 十六进制长度必须是偶数`)
  return prefixed.toLowerCase() as Hex
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value == null) return ''
  if (value instanceof Uint8Array) return bytesToPrefixed(value)
  return JSON.stringify(toJson(value))
}

function toJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array) return bytesToPrefixed(value)
  if (Array.isArray(value)) return value.map(toJson)
  const record = asRecord(value)
  if (record) return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, toJson(item)]))
  return value
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}
