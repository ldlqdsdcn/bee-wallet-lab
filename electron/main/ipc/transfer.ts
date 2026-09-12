import { IPC } from '../../../shared/ipc'
import type {
  AccountRecord,
  BroadcastResult,
  TransferDraftInput,
  TransferPreview,
  TransactionRecord,
  TronEnergyFeeMode,
} from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { previewTransfer, receiveInfo, submitTransfer } from '../transfer/service'
import { listNetworkTransactions, syncNetworkTransactions } from '../history/service'

export function registerTransferIpc(): void {
  handle<TransferDraftInput, TransferPreview>(IPC.transferPreview, (arg) =>
    previewTransfer(requireObject<TransferDraftInput>(arg)),
  )

  handle<{ draftId: string; energyFeeMode?: TronEnergyFeeMode }, BroadcastResult>(IPC.transferSubmit, (arg) =>
    submitTransfer(requireString(arg?.draftId, 'draftId'), arg?.energyFeeMode),
  )

  handle<{ accountId: string }, AccountRecord>(IPC.transferReceiveInfo, (arg) =>
    receiveInfo(requireString(arg?.accountId, 'accountId')),
  )

  handle<{ accountId?: string; networkPk?: string }, TransactionRecord[]>(IPC.transactionList, (arg) =>
    listNetworkTransactions(arg?.networkPk, arg?.accountId),
  )

  handle<{ networkPk: string }, TransactionRecord[]>(IPC.transactionSync, async (arg) =>
    syncNetworkTransactions(requireString(arg?.networkPk, 'networkPk')),
  )
}
