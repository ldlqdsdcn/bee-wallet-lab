import { IPC } from '../../../shared/ipc'
import type { SignMessageInput, SignMessageResult, VerifyMessageInput, VerifyMessageResult } from '../../../shared/types'
import { handle, requireObject } from './registry'
import { signMessage, verifyMessage } from '../sign'

export function registerSignIpc(): void {
  handle<SignMessageInput, SignMessageResult>(IPC.signMessage, (arg) =>
    signMessage(requireObject<SignMessageInput>(arg)),
  )

  handle<VerifyMessageInput, VerifyMessageResult>(IPC.verifyMessage, (arg) =>
    verifyMessage(requireObject<VerifyMessageInput>(arg)),
  )
}
