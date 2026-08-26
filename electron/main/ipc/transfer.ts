import { IPC } from '../../../shared/ipc'
import type {
  AccountRecord,
  BroadcastResult,
  TransferDraftInput,
  TransferPreview,
  TransactionRecord,
} from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import {
  listLocalTransactions,
  previewTransfer,
  receiveInfo,
  submitTransfer,
} from '../transfer/service'

export function registerTransferIpc(): void {
  handle<TransferDraftInput, TransferPreview>(IPC.transferPreview, (arg) =>
    previewTransfer(requireObject<TransferDraftInput>(arg)),
  )

  handle<{ draftId: string }, BroadcastResult>(IPC.transferSubmit, (arg) =>
    submitTransfer(requireString(arg?.draftId, 'draftId')),
  )

  handle<{ accountId: string }, AccountRecord>(IPC.transferReceiveInfo, (arg) =>
    receiveInfo(requireString(arg?.accountId, 'accountId')),
  )

  handle<{ accountId?: string }, TransactionRecord[]>(IPC.transactionList, (arg) =>
    listLocalTransactions(arg?.accountId),
  )

  handle<{ accountId?: string }, TransactionRecord[]>(IPC.transactionSync, (arg) =>
    listLocalTransactions(arg?.accountId),
  )
}
