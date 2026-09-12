import { IPC } from '../../../shared/ipc'
import type { SwapHistoryItem, SwapQuote, SwapQuoteInput, SwapSubmitInput, SwapSubmitResult } from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { listAccountSwaps, quoteSwap, submitSwap } from '../swap/service'

export function registerSwapIpc(): void {
  handle<SwapQuoteInput, SwapQuote>(IPC.swapQuote, (arg) => quoteSwap(requireObject<SwapQuoteInput>(arg)))

  handle<SwapSubmitInput, SwapSubmitResult>(IPC.swapSubmit, (arg) => submitSwap(requireObject<SwapSubmitInput>(arg)))

  handle<{ accountId: string; networkPk: string }, SwapHistoryItem[]>(IPC.swapList, (arg) =>
    listAccountSwaps(requireString(arg?.accountId, 'accountId'), requireString(arg?.networkPk, 'networkPk')),
  )
}
