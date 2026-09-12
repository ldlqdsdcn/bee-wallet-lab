import { IPC } from '../../../shared/ipc'
import type {
  BridgeHistoryItem,
  BridgeQuote,
  BridgeQuoteInput,
  BridgeStatus,
  BridgeSubmitInput,
  BridgeSubmitResult,
} from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { getBridgeStatus, listAccountBridges, quoteBridge, submitBridge } from '../bridge/service'

export function registerBridgeIpc(): void {
  handle<BridgeQuoteInput, BridgeQuote>(IPC.bridgeQuote, (arg) => quoteBridge(requireObject<BridgeQuoteInput>(arg)))

  handle<BridgeSubmitInput, BridgeSubmitResult>(IPC.bridgeSubmit, (arg) =>
    submitBridge(requireObject<BridgeSubmitInput>(arg)),
  )

  handle<{ quoteId: string }, BridgeStatus>(IPC.bridgeStatus, (arg) =>
    getBridgeStatus(requireString(arg?.quoteId, 'quoteId')),
  )

  handle<{ accountId: string; networkPk: string }, BridgeHistoryItem[]>(IPC.bridgeList, (arg) =>
    listAccountBridges(requireString(arg?.accountId, 'accountId'), requireString(arg?.networkPk, 'networkPk')),
  )
}
