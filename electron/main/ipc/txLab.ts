import { IPC } from '../../../shared/ipc'
import type { BroadcastResult, TxLabBroadcastInput, TxLabDecodeInput, TxLabDecoded, TxLabSigned } from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { signTransferDraft } from '../transfer/service'
import { broadcastTxLab, decodeTxLab } from '../txLab/service'

export function registerTxLabIpc(): void {
  handle<{ draftId: string }, TxLabSigned>(IPC.txLabSign, (arg) =>
    signTransferDraft(requireString(arg?.draftId, 'draftId')),
  )

  handle<TxLabDecodeInput, TxLabDecoded>(IPC.txLabDecode, (arg) =>
    decodeTxLab(requireObject<TxLabDecodeInput>(arg)),
  )

  handle<TxLabBroadcastInput, BroadcastResult>(IPC.txLabBroadcast, (arg) =>
    broadcastTxLab(requireObject<TxLabBroadcastInput>(arg)),
  )
}
