import { IPC } from '../../../shared/ipc'
import type { IssuedTokenRecord, TokenIssueInput, TokenIssuePreview, TokenIssueResult } from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import { listIssuedTokens, previewTokenIssue, submitTokenIssue } from '../token/service'

export function registerTokenIpc(): void {
  handle<TokenIssueInput, TokenIssuePreview>(IPC.tokenIssuePreview, (arg) =>
    previewTokenIssue(requireObject<TokenIssueInput>(arg)),
  )
  handle<{ draftId: string }, TokenIssueResult>(IPC.tokenIssueSubmit, (arg) =>
    submitTokenIssue(requireString(arg?.draftId, 'draftId')),
  )
  handle<{ networkPk?: string }, IssuedTokenRecord[]>(IPC.tokenIssueList, (arg) =>
    listIssuedTokens(typeof arg?.networkPk === 'string' && arg.networkPk ? arg.networkPk : undefined),
  )
}
