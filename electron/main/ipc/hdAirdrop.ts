import { IPC } from '../../../shared/ipc'
import type {
  HdAirdropInput,
  HdAirdropItemPage,
  HdAirdropItemQuery,
  HdAirdropJob,
  HdAirdropPreview,
  HdAirdropRetryInput,
} from '../../../shared/types'
import { handle, requireObject, requireString } from './registry'
import {
  getHdAirdropJob,
  listHdAirdropItemRecords,
  listHdAirdropJobRecords,
  previewHdAirdrop,
  retryHdAirdrop,
  startHdAirdrop,
  stopHdAirdrop,
} from '../hdAirdrop/service'

export function registerHdAirdropIpc(): void {
  handle<HdAirdropInput, HdAirdropPreview>(IPC.hdAirdropPreview, (arg) =>
    previewHdAirdrop(requireObject<HdAirdropInput>(arg)),
  )
  handle<{ draftId: string }, HdAirdropJob>(IPC.hdAirdropStart, (arg) =>
    startHdAirdrop(requireString(arg?.draftId, 'draftId')),
  )
  handle<{ jobId?: string } | undefined, HdAirdropJob | null>(IPC.hdAirdropStop, (arg) =>
    stopHdAirdrop(typeof arg?.jobId === 'string' && arg.jobId ? arg.jobId : undefined),
  )
  handle<{ jobId?: string } | undefined, HdAirdropJob | null>(IPC.hdAirdropStatus, (arg) =>
    getHdAirdropJob(typeof arg?.jobId === 'string' && arg.jobId ? arg.jobId : undefined),
  )
  handle<{ walletId?: string; networkPk?: string; jobKind?: string } | undefined, HdAirdropJob[]>(
    IPC.hdAirdropJobs,
    (arg) =>
      listHdAirdropJobRecords(
        typeof arg?.walletId === 'string' && arg.walletId ? arg.walletId : undefined,
        typeof arg?.networkPk === 'string' && arg.networkPk ? arg.networkPk : undefined,
        arg?.jobKind === 'itemized' || arg?.jobKind === 'uniform' ? arg.jobKind : undefined,
      ),
  )
  handle<HdAirdropItemQuery, HdAirdropItemPage>(IPC.hdAirdropItems, (arg) =>
    listHdAirdropItemRecords(requireObject<HdAirdropItemQuery>(arg)),
  )
  handle<HdAirdropRetryInput, HdAirdropJob>(IPC.hdAirdropRetry, (arg) =>
    retryHdAirdrop(requireObject<HdAirdropRetryInput>(arg)),
  )
}
