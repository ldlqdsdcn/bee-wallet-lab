/**
 * 按链查询单笔交易是否上链。解析函数可单测，不打节点。
 */
import type { NetworkRecord, TransactionRecord } from '@shared/types'
import { asRecord, asString } from '../backend/list'
import { fetchBitcoinTx } from '../chain/bitcoin'
import { fetchEvmReceipt } from '../chain/evm'
import { fetchSolanaSignatureStatus } from '../chain/solana'
import { fetchTronTxInfo } from '../chain/tron'

export interface TxChainStatus {
  status: TransactionRecord['status']
  blockHeight: number | null
}

function parseHexQuantity(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = asString(value)
  if (!text) return null
  const parsed = text.startsWith('0x') ? Number.parseInt(text, 16) : Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseEvmReceipt(payload: unknown): TxChainStatus {
  const row = asRecord(payload)
  if (!row) return { status: 'pending', blockHeight: null }
  const code = asString(row.status, String(row.status ?? '')).toLowerCase()
  const blockHeight = parseHexQuantity(row.blockNumber)
  if (code === '0x0' || code === '0') return { status: 'failed', blockHeight }
  if (code === '0x1' || code === '1' || blockHeight != null) return { status: 'confirmed', blockHeight }
  return { status: 'pending', blockHeight: null }
}

export function parseEsploraTx(payload: unknown): TxChainStatus {
  const row = asRecord(payload)
  const status = asRecord(row?.status)
  if (!status) return { status: 'pending', blockHeight: null }
  const height = parseHexQuantity(status.block_height)
  if (status.confirmed === true) return { status: 'confirmed', blockHeight: height }
  return { status: 'pending', blockHeight: null }
}

export function parseTronTxInfo(payload: unknown): TxChainStatus {
  const row = asRecord(payload)
  if (!row || (!row.id && !row.txID && row.blockNumber == null && !row.receipt)) {
    return { status: 'pending', blockHeight: null }
  }
  const receipt = asRecord(row.receipt)
  const result = asString(row.result, asString(receipt?.result)).toUpperCase()
  const blockHeight = parseHexQuantity(row.blockNumber)
  if (result === 'FAILED' || result === 'REVERT' || result === 'OUT_OF_ENERGY') {
    return { status: 'failed', blockHeight }
  }
  if (blockHeight != null && blockHeight > 0) return { status: 'confirmed', blockHeight }
  return { status: 'pending', blockHeight: null }
}

export function parseSolanaSignatureStatus(payload: unknown): TxChainStatus {
  const row = asRecord(payload)
  if (!row) return { status: 'pending', blockHeight: null }
  if (row.err != null) {
    return { status: 'failed', blockHeight: parseHexQuantity(row.slot) }
  }
  const confirmation = asString(row.confirmationStatus).toLowerCase()
  const slot = parseHexQuantity(row.slot)
  if (confirmation === 'confirmed' || confirmation === 'finalized' || row.confirmations === 0) {
    return { status: 'confirmed', blockHeight: slot }
  }
  return { status: 'pending', blockHeight: slot }
}

export async function fetchTransactionStatus(network: NetworkRecord, txid: string): Promise<TxChainStatus> {
  if (network.walletType === 'web3') return parseEvmReceipt(await fetchEvmReceipt(network, txid))
  if (network.walletType === 'bitcoin') return parseEsploraTx(await fetchBitcoinTx(txid, network.networkScope))
  if (network.walletType === 'tron') return parseTronTxInfo(await fetchTronTxInfo(txid, network.networkScope))
  return parseSolanaSignatureStatus(await fetchSolanaSignatureStatus(network, txid))
}
