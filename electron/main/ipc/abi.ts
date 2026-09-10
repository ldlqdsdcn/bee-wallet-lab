import { IPC } from '../../../shared/ipc'
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
} from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import {
  abiPreset,
  decodeAbiCall,
  decodeAbiEvent,
  decodeAbiResult,
  encodeAbi,
  listSavedAbis,
  parseAbiJson,
  removeSavedAbi,
  upsertSavedAbi,
} from '../abi/service'

export function registerAbiIpc(): void {
  handle<{ abiJson: string; name?: string; contractAddress?: string }, AbiParsed>(IPC.abiParse, (arg) =>
    parseAbiJson(requireString(arg?.abiJson, 'abiJson'), arg?.name, arg?.contractAddress),
  )

  handle<{ id: string }, { id: string; name: string; abiJson: string }>(IPC.abiPreset, (arg) =>
    abiPreset(requireString(arg?.id, 'id')),
  )

  handle<void, AbiContractRecord[]>(IPC.abiList, () => listSavedAbis())

  handle<AbiContractUpsertInput, AbiContractRecord>(IPC.abiUpsert, (arg) =>
    upsertSavedAbi(requireObject<AbiContractUpsertInput>(arg)),
  )

  handle<{ id: string }, true>(IPC.abiRemove, (arg) => removeSavedAbi(requireString(arg?.id, 'id')))

  handle<AbiEncodeInput, AbiEncodeResult>(IPC.abiEncode, (arg) => encodeAbi(requireObject<AbiEncodeInput>(arg)))

  handle<AbiDecodeCallInput, AbiDecodeCallResult>(IPC.abiDecodeCall, (arg) =>
    decodeAbiCall(requireObject<AbiDecodeCallInput>(arg)),
  )

  handle<AbiDecodeResultInput, AbiDecodeResultOutput>(IPC.abiDecodeResult, (arg) =>
    decodeAbiResult(requireObject<AbiDecodeResultInput>(arg)),
  )

  handle<AbiDecodeEventInput, AbiDecodeEventResult>(IPC.abiDecodeEvent, (arg) =>
    decodeAbiEvent(requireObject<AbiDecodeEventInput>(arg)),
  )
}
