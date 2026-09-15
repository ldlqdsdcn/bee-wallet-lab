/**
 * 把当前账户的主币或 ERC-20 按地址列表逐笔打出。
 * 每笔写入 hd_airdrop_jobs / hd_airdrop_items，失败可单笔或批量重试。
 */
import type {
  HdAirdropInput,
  HdAirdropItem,
  HdAirdropItemPage,
  HdAirdropItemQuery,
  HdAirdropJob,
  HdAirdropPreview,
  HdAirdropRetryInput,
  NetworkRecord,
  TokenRecord,
} from '@shared/types'
import { collectRecipientAddresses } from '../../../shared/airdropAddresses'
import { IPC_EVENT } from '../../../shared/ipc'
import { newId, wipe } from '../security/crypto'
import { formatMinor, parseDecimalToMinor } from '../util/amount'
import { getNetwork, getToken } from '../db/repos/catalogRepo'
import { getAccountRow } from '../db/repos/accountRepo'
import { upsertTransaction } from '../db/repos/transactionRepo'
import {
  getHdAirdropJob as getStoredJob,
  insertHdAirdropItems,
  insertHdAirdropJob,
  listHdAirdropItemPage,
  listHdAirdropItemsByIds,
  listHdAirdropItemsByStatus,
  listHdAirdropJobs,
  listRunningHdAirdropJobs,
  refreshHdAirdropJobCounts,
  updateHdAirdropItem,
  updateHdAirdropJob,
} from '../db/repos/hdAirdropRepo'
import { broadcast, invalidArg, notFound } from '../ipc/registry'
import { findHdKeyByAddress, getHdKeyRow } from '../db/repos/hdKeyRepo'
import { getAccount, withAccountPrivateKey, withHdPrivateKey } from '../wallets/service'
import {
  broadcastEvmTx,
  encodeErc20Transfer,
  estimateEvmGas,
  explorerUrlForEvm,
  getErc20Balance,
  getEvmBalance,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
  type EvmFeeQuote,
} from '../chain/evm'
import { watchTransaction } from '../history/watch'
import { holdIdleLock } from '../security/vault'
import { estimateAirdropDurationMs, formatDuration, randomBigIntInclusive } from './amount'

const MAX_RECIPIENTS = 20_000
const DRAFT_TTL_MS = 10 * 60 * 1000
const GAP_MS = 120

interface Payer {
  walletId: string
  accountId: string
  address: string
  hdKeyId: string | null
}

interface Draft {
  input: HdAirdropInput
  preview: HdAirdropPreview
  network: NetworkRecord
  token: TokenRecord
  payer: Payer
  recipients: { address: string; addressIndex: number }[]
  minMinor: bigint
  maxMinor: bigint
  gasLimit: bigint
  evmFee: EvmFeeQuote
  createdAt: number
}

interface Runtime {
  stopRequested: boolean
}

const drafts = new Map<string, Draft>()
const runtimes = new Map<string, Runtime>()

function prune(): void {
  const now = Date.now()
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) drafts.delete(id)
  }
}

function contractOf(token: TokenRecord): string | null {
  const value = token.contractAddress?.trim() ?? ''
  if (!token.isToken || !value || value === '0' || /^0x0+$/i.test(value)) return null
  return value
}

function transferCall(token: TokenRecord, to: string, amount: bigint): {
  to: string
  value: bigint
  data?: ReturnType<typeof encodeErc20Transfer>
} {
  const contract = contractOf(token)
  if (contract) return { to: contract, value: 0n, data: encodeErc20Transfer(to, amount) }
  return { to, value: amount }
}

function parseAmount(raw: string | undefined, decimals: number, label: string): bigint {
  try {
    const value = parseDecimalToMinor(raw ?? '', decimals)
    if (value <= 0n) throw new Error(`${label}必须大于 0`)
    return value
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : `${label}不合法`)
  }
}

function emit(job: HdAirdropJob): void {
  broadcast(IPC_EVENT.hdAirdropProgress, job)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasRunning(): boolean {
  return runtimes.size > 0
}

function resolvePayer(input: HdAirdropInput): Payer {
  const account = getAccount(input.accountId)
  if (account.walletType !== 'web3') throw invalidArg('请选择 EVM 付款账户')
  if (account.walletId && account.walletId !== input.walletId) {
    throw invalidArg('付款账户不属于当前钱包')
  }
  const hdKeyId = input.hdKeyId?.trim()
  if (!hdKeyId) return { walletId: input.walletId, accountId: account.id, address: account.address, hdKeyId: null }
  const row = getHdKeyRow(hdKeyId)
  if (!row || row.wallet_id !== input.walletId) throw notFound('分层付款地址不存在')
  if (row.wallet_type !== 'web3') throw invalidArg('请选择 EVM 分层地址')
  return { walletId: input.walletId, accountId: account.id, address: row.address, hdKeyId: row.id }
}

function payerOfJob(job: HdAirdropJob): Payer {
  const hd = findHdKeyByAddress(job.walletId, job.fromAddress)
  if (hd && hd.wallet_type === 'web3') {
    return { walletId: job.walletId, accountId: job.accountId, address: hd.address, hdKeyId: hd.id }
  }
  const account = getAccount(job.accountId)
  return { walletId: job.walletId, accountId: account.id, address: job.fromAddress || account.address, hdKeyId: null }
}

async function withPayerKey<T>(payer: Payer, fn: (privateKey: Uint8Array) => Promise<T>): Promise<T> {
  if (payer.hdKeyId) {
    return withHdPrivateKey(payer.walletId, payer.hdKeyId, (privateKey) => {
      const copy = Uint8Array.from(privateKey)
      return fn(copy).finally(() => wipe(copy))
    })
  }
  const row = getAccountRow(payer.accountId)
  if (!row) throw notFound('付款账户不存在')
  return withAccountPrivateKey(row, (privateKey) => {
    const copy = Uint8Array.from(privateKey)
    return fn(copy).finally(() => wipe(copy))
  })
}

export function recoverInterruptedHdAirdrops(): void {
  for (const job of listRunningHdAirdropJobs()) {
    if (runtimes.has(job.id)) continue
    const next = updateHdAirdropJob(job.id, {
      status: 'stopped',
      finishedAt: Date.now(),
      lastError: job.lastError ?? '应用退出，任务已中断。未发送和失败的可以重试。',
    })
    if (next) emit(next)
  }
}

export async function previewHdAirdrop(input: HdAirdropInput): Promise<HdAirdropPreview> {
  prune()
  const network = getNetwork(input.networkPk)
  if (!network) throw notFound('网络不存在')
  if (network.walletType !== 'web3') throw invalidArg('批量转账只能在 EVM 网络使用')
  const token = getToken(input.tokenPk)
  if (!token) throw notFound('代币不存在')
  if (token.networkPk !== network.id) throw invalidArg('代币不属于当前网络')
  const contract = contractOf(token)
  const payer = resolvePayer(input)

  const parsed = collectRecipientAddresses((input.recipients ?? []).join(','))
  if (parsed.invalid.length > 0) {
    const sample = parsed.invalid.slice(0, 3).join(', ')
    throw invalidArg(`有 ${parsed.invalid.length} 个地址不合法，例如：${sample}`)
  }
  if (parsed.addresses.length === 0) throw invalidArg('请至少填写一个收款地址')
  if (parsed.addresses.length > MAX_RECIPIENTS) throw invalidArg(`一次最多转给 ${MAX_RECIPIENTS} 个地址`)

  const recipients = parsed.addresses.map((address, index) => ({
    address,
    addressIndex: index + 1,
  }))
  const missingCount = 0
  let minMinor: bigint
  let maxMinor: bigint
  if (input.amountMode === 'range') {
    minMinor = parseAmount(input.amountMin, token.decimals, '下限')
    maxMinor = parseAmount(input.amountMax, token.decimals, '上限')
    if (maxMinor < minMinor) throw invalidArg('随机上限不能小于下限')
  } else {
    minMinor = parseAmount(input.amount, token.decimals, '额度')
    maxMinor = minMinor
  }

  const sample = transferCall(token, recipients[0]!.address, minMinor)
  const quotes = await quoteEvmFees(network)
  const evmFee = quotes.medium
  let gasLimit: bigint
  try {
    gasLimit = await estimateEvmGas({
      network,
      from: payer.address,
      ...sample,
    })
  } catch (err) {
    if (contract) throw err
    gasLimit = 21000n
  }
  const feeEach = (evmFee.maxFeePerGas || evmFee.gasPrice || 0n) * gasLimit
  const feeAll = feeEach * BigInt(recipients.length)
  const maxTotal = maxMinor * BigInt(recipients.length)
  const minTotal = minMinor * BigInt(recipients.length)
  const estimatedMs = estimateAirdropDurationMs(recipients.length)
  const gasSymbol = network.coinEasy ?? 'ETH'

  const warnings: string[] = []
  if (parsed.duplicateCount > 0) {
    warnings.push(`已去掉 ${parsed.duplicateCount} 个重复地址，将转给 ${recipients.length} 个地址。`)
  }
  if (input.amountMode === 'range') {
    warnings.push('每笔金额在上下限之间随机，实际打出总量通常低于预估上限。重试时沿用首次抽到的金额。')
  }
  warnings.push(`按顺序逐笔广播，${recipients.length} 笔大约 ${formatDuration(estimatedMs)}。RPC 慢时可能到 ${formatDuration(estimatedMs * 2)}。`)
  warnings.push('每笔都会写入批量转账表。失败或中途停止后可以单笔重试，或一键重试。')

  if (contract) {
    try {
      const tokenBalance = await getErc20Balance(network, contract, payer.address)
      if (tokenBalance < minTotal) {
        warnings.push(`代币余额可能不够：当前 ${formatMinor(tokenBalance, token.decimals)} ${token.symbol}。`)
      } else if (tokenBalance < maxTotal) {
        warnings.push(`代币余额低于随机上限合计 ${formatMinor(maxTotal, token.decimals)} ${token.symbol}。`)
      }
    } catch {
      warnings.push('暂时读不到代币余额，请确认付款账户有足够额度。')
    }
    try {
      const native = await getEvmBalance(network, payer.address)
      if (native < feeAll) {
        warnings.push(`原生币可能不够付 Gas：预估 ${formatMinor(feeAll, 18)} ${gasSymbol}。`)
      }
    } catch {
      warnings.push('暂时读不到 Gas 余额。')
    }
  } else {
    try {
      const native = await getEvmBalance(network, payer.address)
      if (native < minTotal + feeAll) {
        warnings.push(
          `主币余额可能不够：转账加 Gas 至少约 ${formatMinor(minTotal + feeAll, token.decimals)} ${token.symbol}，当前 ${formatMinor(native, token.decimals)}。`,
        )
      } else if (native < maxTotal + feeAll) {
        warnings.push(
          `主币余额低于随机上限加 Gas：约 ${formatMinor(maxTotal + feeAll, token.decimals)} ${token.symbol}。`,
        )
      }
    } catch {
      warnings.push('暂时读不到主币余额，请确认付款账户有足够额度付转账和 Gas。')
    }
  }

  const preview: HdAirdropPreview = {
    draftId: newId(),
    from: payer.address,
    symbol: token.symbol,
    decimals: token.decimals,
    recipientCount: recipients.length,
    missingCount,
    amountMode: input.amountMode,
    amountText:
      input.amountMode === 'range'
        ? `${formatMinor(minMinor, token.decimals)}–${formatMinor(maxMinor, token.decimals)} ${token.symbol}`
        : `${formatMinor(minMinor, token.decimals)} ${token.symbol}`,
    estimatedTotal: `${formatMinor(maxTotal, token.decimals)} ${token.symbol}`,
    feeText: `${formatMinor(feeAll, 18)} ${network.coinEasy ?? 'ETH'}`,
    estimatedMs,
    estimatedText: formatDuration(estimatedMs),
    warnings,
  }
  drafts.set(preview.draftId, {
    input,
    preview,
    network,
    token,
    payer,
    recipients,
    minMinor,
    maxMinor,
    gasLimit,
    evmFee,
    createdAt: Date.now(),
  })
  return preview
}

export async function startHdAirdrop(draftId: string): Promise<HdAirdropJob> {
  prune()
  recoverInterruptedHdAirdrops()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('预览已过期，请重新预览')
  drafts.delete(draftId)
  if (hasRunning()) throw invalidArg('已有批量转账在进行，请先等它结束或停止')

  const now = Date.now()
  const jobId = newId()
  const sender = draft.payer.address.toLowerCase()
  const items: HdAirdropItem[] = draft.recipients.map((dest) => {
    const amount =
      draft.minMinor === draft.maxMinor
        ? draft.minMinor
        : randomBigIntInclusive(draft.minMinor, draft.maxMinor)
    const self = dest.address.toLowerCase() === sender
    return {
      id: newId(),
      jobId,
      addressIndex: dest.addressIndex,
      toAddress: dest.address,
      amount: formatMinor(amount, draft.token.decimals),
      amountMinor: amount.toString(),
      status: self ? 'skipped' : 'queued',
      txid: null,
      explorerUrl: null,
      error: self ? '收款地址与付款账户相同' : null,
      attemptCount: 0,
      updatedAt: now,
    }
  })
  const skipped = items.filter((item) => item.status === 'skipped').length
  const queued = items.length - skipped
  const estimatedMs = estimateAirdropDurationMs(queued)

  insertHdAirdropJob({
    id: jobId,
    walletId: draft.input.walletId,
    accountId: draft.payer.accountId,
    networkPk: draft.network.id,
    tokenPk: draft.token.id,
    fromAddress: draft.payer.address,
    symbol: draft.token.symbol,
    decimals: draft.token.decimals,
    amountMode: draft.input.amountMode,
    amountText: draft.preview.amountText,
    fromIndex: 1,
    toIndex: items.length,
    accountIndex: 0,
    status: 'running',
    total: items.length,
    queued,
    pending: 0,
    confirmed: 0,
    failed: 0,
    skipped,
    currentIndex: null,
    lastTxid: null,
    lastError: null,
    estimatedMs,
    startedAt: now,
    finishedAt: null,
  })
  insertHdAirdropItems(items)

  const job = getStoredJob(jobId)!
  emit(job)
  void executeJob(jobId, items.filter((item) => item.status === 'queued'), {
    network: draft.network,
    token: draft.token,
    payer: draft.payer,
    gasLimit: draft.gasLimit,
    evmFee: draft.evmFee,
  }).catch((err) => {
    const next = updateHdAirdropJob(jobId, {
      status: 'failed',
      finishedAt: Date.now(),
      lastError: err instanceof Error ? err.message : String(err),
    })
    if (next) emit(next)
  })
  return job
}

export function stopHdAirdrop(jobId?: string): HdAirdropJob | null {
  const runtimeId = jobId ?? [...runtimes.keys()][0]
  if (runtimeId) {
    const runtime = runtimes.get(runtimeId)
    if (runtime) runtime.stopRequested = true
    return getStoredJob(runtimeId)
  }
  const running = listRunningHdAirdropJobs()[0]
  return running ?? null
}

export function stopAllHdAirdrops(): void {
  for (const runtime of runtimes.values()) runtime.stopRequested = true
}

export function getHdAirdropJob(jobId?: string): HdAirdropJob | null {
  recoverInterruptedHdAirdrops()
  if (jobId) return getStoredJob(jobId)
  const runningId = [...runtimes.keys()][0]
  if (runningId) return getStoredJob(runningId)
  return listHdAirdropJobs()[0] ?? null
}

export function listHdAirdropJobRecords(walletId?: string, networkPk?: string): HdAirdropJob[] {
  recoverInterruptedHdAirdrops()
  return listHdAirdropJobs(walletId, networkPk)
}

export function listHdAirdropItemRecords(query: HdAirdropItemQuery): HdAirdropItemPage {
  if (!query?.jobId) throw invalidArg('jobId 不能为空')
  return listHdAirdropItemPage(query)
}

export async function retryHdAirdrop(input: HdAirdropRetryInput): Promise<HdAirdropJob> {
  recoverInterruptedHdAirdrops()
  if (hasRunning()) throw invalidArg('已有批量转账在进行，请先等它结束或停止')
  const job = getStoredJob(input.jobId)
  if (!job) throw notFound('批量转账记录不存在')

  const items = input.itemIds?.length
    ? listHdAirdropItemsByIds(job.id, input.itemIds)
    : listHdAirdropItemsByStatus(
        job.id,
        input.scope === 'queued' ? ['queued'] : input.scope === 'retryable' ? ['failed', 'queued'] : ['failed'],
      )
  const retryable = items.filter((item) => item.status === 'failed' || item.status === 'queued')
  if (retryable.length === 0) throw invalidArg('没有可重试的记录')

  const network = getNetwork(job.networkPk)
  if (!network) throw notFound('网络不存在')
  const token = getToken(job.tokenPk)
  if (!token) throw notFound('代币不存在')
  const payer = payerOfJob(job)
  const quotes = await quoteEvmFees(network)
  const evmFee = quotes.medium
  const sample = transferCall(token, retryable[0]!.toAddress, BigInt(retryable[0]!.amountMinor))
  let gasLimit: bigint
  try {
    gasLimit = await estimateEvmGas({
      network,
      from: payer.address,
      ...sample,
    })
  } catch (err) {
    if (contractOf(token)) throw err
    gasLimit = 21000n
  }

  updateHdAirdropJob(job.id, {
    status: 'running',
    finishedAt: null,
    lastError: null,
    estimatedMs: estimateAirdropDurationMs(retryable.length),
  })
  const latest = getStoredJob(job.id)!
  emit(latest)
  void executeJob(job.id, retryable, { network, token, payer, gasLimit, evmFee }).catch((err) => {
    const next = updateHdAirdropJob(job.id, {
      status: 'failed',
      finishedAt: Date.now(),
      lastError: err instanceof Error ? err.message : String(err),
    })
    if (next) emit(next)
  })
  return latest
}

async function executeJob(
  jobId: string,
  items: HdAirdropItem[],
  ctx: {
    network: NetworkRecord
    token: TokenRecord
    payer: Payer
    gasLimit: bigint
    evmFee: EvmFeeQuote
  },
): Promise<void> {
  const runtime: Runtime = { stopRequested: false }
  runtimes.set(jobId, runtime)
  const releaseIdleLock = holdIdleLock()
  let nonce = await getEvmNonce(ctx.network, ctx.payer.address)

  try {
    await withPayerKey(ctx.payer, async (privateKey) => {
      for (const item of items) {
        if (runtime.stopRequested) {
          const next = updateHdAirdropJob(jobId, {
            status: 'stopped',
            finishedAt: Date.now(),
            currentIndex: null,
            lastError: '已停止，未发送和失败的可以重试',
          })
          if (next) emit(refreshHdAirdropJobCounts(jobId) ?? next)
          return
        }
        updateHdAirdropJob(jobId, { currentIndex: item.addressIndex })
        try {
          const call = transferCall(ctx.token, item.toAddress, BigInt(item.amountMinor))
          const signed = await signAndSerializeEvmTx({
            privateKey,
            chainId: Number(ctx.network.chainId),
            nonce,
            to: call.to,
            value: call.value,
            data: call.data,
            gasLimit: ctx.gasLimit,
            fee: ctx.evmFee,
          })
          const txid = await broadcastEvmTx(ctx.network, signed.hex)
          nonce += 1
          const explorerUrl = explorerUrlForEvm(txid, ctx.network.browser, ctx.network.chainId)
          updateHdAirdropItem(item.id, {
            status: 'pending',
            txid,
            explorerUrl,
            error: null,
            attemptCount: item.attemptCount + 1,
          })
          const record = upsertTransaction({
            id: newId(),
            networkPk: ctx.network.id,
            accountId: ctx.payer.accountId,
            txid,
            direction: 'send',
            fromAddress: ctx.payer.address,
            toAddress: item.toAddress,
            tokenPk: ctx.token.id,
            symbol: ctx.token.symbol,
            amount: item.amount,
            fee: formatMinor((ctx.evmFee.maxFeePerGas || ctx.evmFee.gasPrice || 0n) * ctx.gasLimit, 18),
            status: 'pending',
            blockHeight: null,
            rawHex: signed.hex,
            createdAt: Date.now(),
            explorerUrl,
          })
          watchTransaction(record)
          broadcast(IPC_EVENT.transactionUpdated, { record })
          const job = refreshHdAirdropJobCounts(jobId)
          if (job) emit(updateHdAirdropJob(jobId, { lastTxid: txid, lastError: null }) ?? job)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          updateHdAirdropItem(item.id, {
            status: 'failed',
            error: message,
            attemptCount: item.attemptCount + 1,
          })
          const job = refreshHdAirdropJobCounts(jobId)
          if (job) emit(updateHdAirdropJob(jobId, { lastError: message }) ?? job)
          try {
            nonce = await getEvmNonce(ctx.network, ctx.payer.address)
          } catch {
            /* 下一笔再试 */
          }
        }
        await sleep(GAP_MS)
      }
    })
  } finally {
    runtimes.delete(jobId)
    releaseIdleLock()
  }

  const latest = refreshHdAirdropJobCounts(jobId) ?? getStoredJob(jobId)
  if (!latest || latest.status !== 'running') {
    if (latest) emit(latest)
    return
  }
  const status =
    latest.queued === 0 && latest.confirmed === 0 && latest.pending === 0 && latest.failed > 0
      ? 'failed'
      : 'done'
  const next = updateHdAirdropJob(jobId, {
    status,
    finishedAt: Date.now(),
    currentIndex: null,
  })
  if (next) emit(next)
}
