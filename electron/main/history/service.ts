/**
 * 按当前网络从第三方索引同步交易，写入本地 SQLite。
 */
import type { NetworkRecord, TokenRecord, TransactionRecord } from '@shared/types'
import { newId } from '../security/crypto'
import { formatMinor } from '../util/amount'
import { getNetwork, listTokens } from '../db/repos/catalogRepo'
import { listMatchingAccounts } from '../db/repos/accountRepo'
import { latestSyncedBlock, listTransactions, upsertTransaction } from '../db/repos/transactionRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { defaultNativeDecimals } from '../catalog/map'
import { explorerUrlForBitcoin, fetchBitcoinAddressTxs } from '../chain/bitcoin'
import { explorerUrlForEvm } from '../chain/evm'
import {
  explorerUrlForTron,
  fetchTronAccountInternal,
  fetchTronAccountTransactions,
  fetchTronAccountTrc20,
} from '../chain/tron'
import { explorerUrlForSolana, fetchSolanaSignatures, fetchSolanaTransaction } from '../chain/solana'
import { fetchEvmHistory } from './evm'
import {
  parseEsploraAddressTxs,
  parseSolanaSignatures,
  parseSolanaTransaction,
  parseTronGridInternal,
  parseTronGridTransactions,
  parseTronGridTrc20,
} from './parse'
import type { HistoryTxDraft } from './types'

function requireNetwork(networkPk: string): NetworkRecord {
  const network = getNetwork(networkPk)
  if (!network) throw notFound('网络不存在')
  return network
}

function nativeToken(tokens: TokenRecord[]): TokenRecord | undefined {
  return tokens.find((item) => !item.isToken) ?? tokens[0]
}

function matchToken(tokens: TokenRecord[], draft: HistoryTxDraft): TokenRecord | null {
  if (!draft.contractAddress) return nativeToken(tokens) ?? null
  const contract = draft.contractAddress.toLowerCase()
  return (
    tokens.find((item) => (item.contractAddress ?? '').toLowerCase() === contract) ??
    null
  )
}

function explorerUrl(network: NetworkRecord, txid: string): string | null {
  if (network.walletType === 'bitcoin') return explorerUrlForBitcoin(txid, network.networkScope, network.browser)
  if (network.walletType === 'web3') return explorerUrlForEvm(txid, network.browser, network.chainId)
  if (network.walletType === 'solana') return explorerUrlForSolana(txid, network)
  return explorerUrlForTron(txid, network.networkScope, network.browser)
}

function persist(network: NetworkRecord, accountId: string, tokens: TokenRecord[], draft: HistoryTxDraft): void {
  const token = matchToken(tokens, draft)
  const symbol = token?.symbol ?? draft.symbol
  const decimals = token?.decimals ?? draft.decimals
  const feeDecimals = defaultNativeDecimals(network.walletType)
  upsertTransaction({
    id: newId(),
    networkPk: network.id,
    accountId,
    txid: draft.txid,
    direction: draft.direction,
    fromAddress: draft.fromAddress,
    toAddress: draft.toAddress,
    tokenPk: token?.id ?? null,
    symbol,
    amount: formatMinor(draft.amountMinor, decimals),
    fee: draft.feeMinor != null ? formatMinor(draft.feeMinor, feeDecimals) : null,
    status: draft.status,
    blockHeight: draft.blockHeight,
    rawHex: null,
    createdAt: draft.timestampMs || Date.now(),
    explorerUrl: explorerUrl(network, draft.txid),
  })
}

async function fetchForAddress(
  network: NetworkRecord,
  address: string,
  native: TokenRecord | undefined,
  startBlock: number | null,
): Promise<HistoryTxDraft[]> {
  const symbol = native?.symbol || network.coinEasy || 'ETH'
  const decimals = native?.decimals ?? defaultNativeDecimals(network.walletType)
  if (network.walletType === 'bitcoin') {
    const payload = await fetchBitcoinAddressTxs(address, network.networkScope)
    return parseEsploraAddressTxs(payload, address, symbol).filter(
      (item) => startBlock == null || item.blockHeight == null || item.blockHeight >= startBlock,
    )
  }
  if (network.walletType === 'web3') {
    return fetchEvmHistory(network, address, symbol, decimals, startBlock)
  }
  if (network.walletType === 'tron') {
    const [nativeTx, trc20, internal] = await Promise.all([
      fetchTronAccountTransactions(address, network.networkScope),
      fetchTronAccountTrc20(address, network.networkScope).catch(() => ({ data: [] })),
      fetchTronAccountInternal(address, network.networkScope).catch(() => ({ data: [] })),
    ])
    const drafts = [
      ...parseTronGridTransactions(nativeTx, address, symbol),
      ...parseTronGridInternal(internal, address, symbol),
      ...parseTronGridTrc20(trc20, address),
    ]
    return drafts.filter((item) => startBlock == null || item.blockHeight == null || item.blockHeight >= startBlock)
  }
  const signatures = parseSolanaSignatures(await fetchSolanaSignatures(network, address, 20))
  const drafts: HistoryTxDraft[] = []
  const chunk = signatures.slice(0, 15)
  const details = await Promise.allSettled(chunk.map((item) => fetchSolanaTransaction(network, item.signature)))
  details.forEach((result, index) => {
    const meta = chunk[index]
    if (!meta) return
    const payload = result.status === 'fulfilled' ? result.value : null
    drafts.push(...parseSolanaTransaction(payload, address, meta.signature, meta))
  })
  return drafts.filter((item) => startBlock == null || item.blockHeight == null || item.blockHeight >= startBlock)
}

export async function syncNetworkTransactions(networkPk: string): Promise<TransactionRecord[]> {
  if (!networkPk) throw invalidArg('networkPk 不能为空')
  const network = requireNetwork(networkPk)
  const accounts = listMatchingAccounts({
    walletType: network.walletType,
    networkScope: network.networkScope,
  })
  if (accounts.length === 0) return []
  const tokens = listTokens(network.id)
  const native = nativeToken(tokens)
  const errors: string[] = []
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const drafts = await fetchForAddress(
          network,
          account.address,
          native,
          latestSyncedBlock(network.id, account.id),
        )
        for (const draft of drafts) persist(network, account.id, tokens, draft)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }
    }),
  )
  if (errors.length === accounts.length) throw new Error(errors[0] ?? '同步交易失败')
  return listNetworkTransactions(networkPk)
}

export function listNetworkTransactions(networkPk?: string, accountId?: string): TransactionRecord[] {
  const rows = listTransactions({ networkPk, accountId })
  if (!networkPk) return rows
  const network = getNetwork(networkPk)
  if (!network) return rows
  const accounts = new Set(
    listMatchingAccounts({
      walletType: network.walletType,
      networkScope: network.networkScope,
    }).map((item) => item.id),
  )
  return rows.filter((item) => accounts.has(item.accountId))
}
