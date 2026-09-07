/**
 * 部署交易确认后，把新合约写进本地代币目录和发行记录。
 * 以 token_issues 表为准，重启后仍能补写合约地址。
 */
import type { IssuedTokenRecord, NetworkRecord, TokenRecord, TransactionRecord } from '@shared/types'
import { IPC_EVENT } from '../../../shared/ipc'
import { getTransaction, upsertTransaction } from '../db/repos/transactionRepo'
import { findTokenIssueByTxid, updateTokenIssue } from '../db/repos/tokenIssueRepo'
import { upsertCatalogToken } from '../catalog/maintain'
import { fetchEvmReceipt } from '../chain/evm'
import { parseEvmReceipt } from '../history/status'
import { broadcast } from '../ipc/registry'
import { parseCreatedContract } from './encode'

function emitIssue(issue: IssuedTokenRecord, extra?: { token?: TokenRecord; record?: TransactionRecord }): void {
  broadcast(IPC_EVENT.catalogUpdated, { kind: 'issue' })
  if (extra?.record) {
    broadcast(IPC_EVENT.transactionUpdated, {
      record: extra.record,
      token: extra.token ?? null,
      contractAddress: issue.contractAddress,
      issue,
    })
  }
}

export function finalizeIssuedTokenFromReceipt(txid: string, receipt: unknown): TokenRecord | null {
  const issue = findTokenIssueByTxid(txid)
  if (!issue || issue.status !== 'pending') return null

  const parsed = parseEvmReceipt(receipt)
  if (parsed.status === 'pending') return null
  if (parsed.status === 'failed') {
    const next = updateTokenIssue(issue.id, { status: 'failed' }) ?? { ...issue, status: 'failed' as const }
    const existing = issue.transactionId ? getTransaction(issue.transactionId) : null
    emitIssue(next, { record: existing ?? undefined })
    return null
  }

  const contractAddress = parseCreatedContract(receipt)
  if (!contractAddress) {
    const next = updateTokenIssue(issue.id, { status: 'failed' }) ?? { ...issue, status: 'failed' as const }
    emitIssue(next)
    return null
  }

  let token: TokenRecord
  try {
    token = upsertCatalogToken({
      networkPk: issue.networkPk,
      name: issue.name,
      symbol: issue.symbol,
      decimals: issue.decimals,
      contractAddress,
      tokenStandard: 'erc20',
      isDefaultSelected: true,
    })
  } catch (err) {
    console.warn('[token-issue] 写入目录失败', err instanceof Error ? err.message : err)
    updateTokenIssue(issue.id, { contractAddress, status: 'confirmed' })
    return null
  }

  const saved =
    updateTokenIssue(issue.id, {
      contractAddress,
      tokenPk: token.id,
      status: 'confirmed',
    }) ?? { ...issue, contractAddress, tokenPk: token.id, status: 'confirmed' as const }

  const existing = issue.transactionId ? getTransaction(issue.transactionId) : null
  let record: TransactionRecord | null = existing
  if (existing) {
    record = upsertTransaction({
      ...existing,
      toAddress: contractAddress,
      tokenPk: token.id,
      status: parsed.status,
      blockHeight: parsed.blockHeight ?? existing.blockHeight,
    })
  }

  emitIssue(saved, { token, record: record ?? undefined })
  return token
}

export async function tryFinalizeIssuedToken(network: NetworkRecord, txid: string): Promise<TokenRecord | null> {
  const issue = findTokenIssueByTxid(txid)
  if (!issue || issue.status !== 'pending') return null
  const receipt = await fetchEvmReceipt(network, txid)
  if (!receipt) return null
  return finalizeIssuedTokenFromReceipt(txid, receipt)
}
