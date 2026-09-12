import { IPC } from '../../../shared/ipc'
import type { WalletConnectPending, WalletConnectSession, WalletConnectStatus } from '@shared/types'
import { readWalletConnectClipboard } from '../walletconnect/browser'
import {
  decideWalletConnect,
  disconnectWalletConnect,
  listWalletConnectPending,
  listWalletConnectSessions,
  pairWalletConnect,
  walletConnectStatus,
} from '../walletconnect/service'
import { handle, requireString } from './registry'

export function registerWalletConnectIpc(): void {
  handle<void, WalletConnectStatus>(IPC.walletConnectStatus, () => walletConnectStatus())
  handle<{ uri: string }, WalletConnectSession[]>(IPC.walletConnectPair, (arg) =>
    pairWalletConnect(requireString(arg?.uri, 'uri')),
  )
  handle<void, WalletConnectSession[]>(IPC.walletConnectSessions, () => listWalletConnectSessions())
  handle<{ topic: string }, WalletConnectSession[]>(IPC.walletConnectDisconnect, (arg) =>
    disconnectWalletConnect(requireString(arg?.topic, 'topic')),
  )
  handle<void, WalletConnectPending[]>(IPC.walletConnectPending, () => listWalletConnectPending())
  handle<{ id: string; approve: boolean }, true>(IPC.walletConnectDecide, (arg) => {
    decideWalletConnect(requireString(arg?.id, 'id'), Boolean(arg?.approve))
    return true
  })
  handle<void, string>(IPC.walletConnectClipboard, async () => readWalletConnectClipboard())
}
