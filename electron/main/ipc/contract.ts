import { IPC } from '../../../shared/ipc'
import type {
  ContractReadInput,
  ContractReadResult,
  ContractSigned,
  ContractWriteInput,
  ContractWritePreview,
} from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { previewContractWrite, readContract, signContractWrite } from '../contract/service'

export function registerContractIpc(): void {
  handle<ContractReadInput, ContractReadResult>(IPC.contractRead, (arg) =>
    readContract(requireObject<ContractReadInput>(arg)),
  )

  handle<ContractWriteInput, ContractWritePreview>(IPC.contractPreview, (arg) =>
    previewContractWrite(requireObject<ContractWriteInput>(arg)),
  )

  handle<{ draftId: string }, ContractSigned>(IPC.contractSign, (arg) =>
    signContractWrite(requireString(arg?.draftId, 'draftId')),
  )
}
