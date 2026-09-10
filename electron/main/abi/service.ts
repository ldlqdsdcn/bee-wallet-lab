/**
 * ABI 工具：解析、本地库、编码 / 解码。
 */
import type {
  AbiContractRecord,
  AbiContractUpsertInput,
  AbiDecodeCallInput,
  AbiDecodeCallResult,
  AbiDecodeEventInput,
  AbiDecodeEventResult,
  AbiDecodeResultInput,
  AbiDecodeResultOutput,
  AbiEncodeInput,
  AbiEncodeResult,
  AbiParsed,
} from '@shared/types'
import { newId } from '../security/crypto'
import { invalidArg, notFound } from '../ipc/registry'
import {
  deleteAbiContract,
  getAbiContract,
  insertAbiContract,
  listAbiContracts,
  updateAbiContract,
} from '../db/repos/abiRepo'
import { decodeAbiCalldata, decodeAbiEventLog, decodeAbiReturn, encodeAbiCall, parseAbiDocument } from './codec'
import { ABI_PRESETS } from './presets'

function wrap<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : String(err))
  }
}

export function parseAbiJson(abiJson: string, name?: string, contractAddress?: string | null): AbiParsed {
  return wrap(() => parseAbiDocument(abiJson, name, contractAddress))
}

export function abiPreset(id: string): { id: string; name: string; abiJson: string } {
  const preset = ABI_PRESETS[id.trim().toLowerCase()]
  if (!preset) throw invalidArg(`没有预置 ABI：${id}`)
  return { id: id.trim().toLowerCase(), name: preset.name, abiJson: JSON.stringify(preset.abi, null, 2) }
}

export function listSavedAbis(): AbiContractRecord[] {
  return listAbiContracts()
}

export function upsertSavedAbi(input: AbiContractUpsertInput): AbiContractRecord {
  const parsed = parseAbiJson(input.abiJson, input.name, input.contractAddress)
  const name = parsed.name.trim()
  if (!name) throw invalidArg('合约名称不能为空')
  const payload = {
    name,
    contractAddress: parsed.contractAddress,
    abiJson: parsed.abiJson,
    functionCount: parsed.functions.length,
    eventCount: parsed.events.length,
  }
  if (input.id) {
    const existing = getAbiContract(input.id)
    if (!existing) throw notFound('ABI 记录不存在')
    return updateAbiContract({ id: existing.id, ...payload })
  }
  return insertAbiContract({ id: newId(), ...payload })
}

export function removeSavedAbi(id: string): true {
  const existing = getAbiContract(id)
  if (!existing) throw notFound('ABI 记录不存在')
  deleteAbiContract(id)
  return true
}

export function encodeAbi(input: AbiEncodeInput): AbiEncodeResult {
  return wrap(() => encodeAbiCall(input.abiJson, input.signature, input.args ?? []))
}

export function decodeAbiCall(input: AbiDecodeCallInput): AbiDecodeCallResult {
  return wrap(() => decodeAbiCalldata(input.abiJson, input.data))
}

export function decodeAbiResult(input: AbiDecodeResultInput): AbiDecodeResultOutput {
  return wrap(() => decodeAbiReturn(input.abiJson, input.signature, input.data))
}

export function decodeAbiEvent(input: AbiDecodeEventInput): AbiDecodeEventResult {
  return wrap(() => decodeAbiEventLog(input.abiJson, input.data, input.topics))
}
