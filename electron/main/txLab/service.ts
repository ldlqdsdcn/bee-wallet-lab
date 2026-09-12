/**
 * 交易实验室：解码原始交易、单独广播（签名在 transfer 预览草稿上完成）。
 */
import type {
  BroadcastResult,
  NetworkRecord,
  TxLabBroadcastInput,
  TxLabDecodeInput,
  TxLabDecoded,
  WalletType,
} from '@shared/types'
import { IPC_EVENT } from '../../../shared/ipc'
import { newId } from '../security/crypto'
import { getNetwork } from '../db/repos/catalogRepo'
import { findAccountByAddress } from '../db/repos/accountRepo'
import { upsertTransaction } from '../db/repos/transactionRepo'
import { broadcast, invalidArg, notFound } from '../ipc/registry'
import { watchTransaction } from '../history/watch'
import { broadcastBitcoinTx, explorerUrlForBitcoin } from '../chain/bitcoin'
import { broadcastEvmTx, explorerUrlForEvm } from '../chain/evm'
import { broadcastSolanaTx, explorerUrlForSolana } from '../chain/solana'
import { broadcastTronTx, explorerUrlForTron, type TronUnsignedTx } from '../chain/tron'
import { toChecksumAddress } from '../derive/evm'
import { decodeRawTransaction, normalizeBroadcastRaw } from './decode'

export function requireNetwork(id: string): NetworkRecord {
  const network = getNetwork(id)
  if (!network) throw notFound('网络不存在，请先同步目录')
  return network
}

export function decodeTxLab(input: TxLabDecodeInput): TxLabDecoded {
  const network = requireNetwork(input.networkPk)
  const raw = typeof input.raw === 'string' ? input.raw : ''
  try {
    const decoded = decodeRawTransaction(network.walletType, raw)
    return { ...decoded, networkPk: network.id }
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : String(err))
  }
}

export async function broadcastRawOnNetwork(network: NetworkRecord, raw: string): Promise<string> {
  const normalized = normalizeBroadcastRaw(network.walletType, raw)
  if (network.walletType === 'bitcoin') {
    return broadcastBitcoinTx(normalized, network.networkScope)
  }
  if (network.walletType === 'web3') {
    return broadcastEvmTx(network, normalized)
  }
  if (network.walletType === 'solana') {
    return broadcastSolanaTx(network, normalized)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw invalidArg('TRON 广播需要已签名的 JSON 交易')
  }
  const tx = parsed as TronUnsignedTx
  if (!tx?.txID) throw invalidArg('TRON 交易缺少 txID')
  if (!Array.isArray(tx.signature) || tx.signature.length === 0) {
    throw invalidArg('TRON 交易尚未签名，不能广播')
  }
  return broadcastTronTx(tx, network.networkScope)
}

export function explorerUrlForNetwork(network: NetworkRecord, txid: string): string | null {
  if (network.walletType === 'bitcoin') {
    return explorerUrlForBitcoin(txid, network.networkScope, network.browser)
  }
  if (network.walletType === 'web3') {
    return explorerUrlForEvm(txid, network.browser, network.chainId)
  }
  if (network.walletType === 'solana') {
    return explorerUrlForSolana(txid, network)
  }
  return explorerUrlForTron(txid, network.networkScope, network.browser)
}

export function persistBroadcastedTx(input: {
  network: NetworkRecord
  accountId: string
  from: string
  to: string
  tokenPk: string | null
  symbol: string
  amount: string
  fee: string | null
  txid: string
  raw: string
  direction?: 'send' | 'receive'
}): BroadcastResult {
  const explorerUrl = explorerUrlForNetwork(input.network, input.txid)
  const transaction = upsertTransaction({
    id: newId(),
    networkPk: input.network.id,
    accountId: input.accountId,
    txid: input.txid,
    direction: input.direction ?? 'send',
    fromAddress: input.from,
    toAddress: input.to,
    tokenPk: input.tokenPk,
    symbol: input.symbol,
    amount: input.amount,
    fee: input.fee,
    status: 'pending',
    blockHeight: null,
    rawHex: input.raw,
    createdAt: Date.now(),
    explorerUrl,
  })
  watchTransaction(transaction)
  broadcast(IPC_EVENT.transactionUpdated, { record: transaction })
  return { txid: input.txid, explorerUrl, reportedToBackend: false, transaction }
}

export async function broadcastTxLab(input: TxLabBroadcastInput): Promise<BroadcastResult> {
  const network = requireNetwork(input.networkPk)
  const raw = typeof input.raw === 'string' ? input.raw.trim() : ''
  if (!raw) throw invalidArg('原始交易不能为空')

  let decoded: TxLabDecoded | null = null
  try {
    decoded = decodeRawTransaction(network.walletType, raw)
  } catch {
    decoded = null
  }
  if (decoded && !decoded.signed) throw invalidArg('交易尚未签名，不能广播')

  const txid = await broadcastRawOnNetwork(network, raw)
  const from = input.from?.trim() || decoded?.fields.from || decoded?.fields.feePayer || ''
  const to = input.to?.trim() || decoded?.fields.to || ''
  return persistBroadcastedTx({
    network,
    accountId: resolveAccountId(network, input.accountId, from),
    from,
    to,
    tokenPk: input.tokenPk?.trim() || null,
    symbol: input.symbol?.trim() || nativeSymbol(network),
    amount: input.amount?.trim() || decoded?.fields.amount || decoded?.fields.value || '',
    fee: input.fee?.trim() || null,
    txid,
    raw: decoded?.raw ?? raw,
  })
}

function resolveAccountId(network: NetworkRecord, accountId?: string, from?: string): string {
  if (accountId?.trim()) return accountId.trim()
  if (!from) return ''
  const candidates = [from]
  if (network.walletType === 'web3') {
    try {
      candidates.push(toChecksumAddress(from))
    } catch {
      /* 解码出的 from 可能不是地址 */
    }
  }
  for (const address of candidates) {
    const row = findAccountByAddress(network.walletType, network.networkScope, address)
    if (row) return row.id
  }
  return ''
}

function nativeSymbol(network: NetworkRecord): string {
  return network.coinEasy || ''
}

export { normalizeBroadcastRaw }

export function feeDecimalsOf(walletType: WalletType): number {
  if (walletType === 'bitcoin') return 8
  if (walletType === 'tron') return 6
  if (walletType === 'solana') return 9
  return 18
}
