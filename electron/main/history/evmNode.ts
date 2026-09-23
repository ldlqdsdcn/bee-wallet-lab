/**
 * 用当前选中的 EVM 节点（Infura 等）增量同步交易。
 * 标准 JSON-RPC 没有按地址列交易，因此：ERC-20 走 eth_getLogs，原生币扫最近区块。
 */
import type { NetworkRecord, TokenRecord } from '@shared/types'
import { asRecord, asString } from '../backend/list'
import { evmRpc } from '../chain/evm'
import {
  ERC20_TRANSFER_TOPIC,
  addressFromTopic,
  historyBlockWindow,
  nativeScanFrom,
  parseHexNumber,
  toBlockHex,
  topicAddress,
} from './range'
import { sameAddress, type HistoryTxDraft } from './types'

const LOG_CHUNK = 2_000
const MAX_LOG_BLOCKS = 8_000
const MAX_NATIVE_BLOCKS = 400
const FIRST_SYNC_NATIVE_BLOCKS = 80
const RPC_CONCURRENCY = 8

interface RpcLog {
  address?: string
  topics?: string[]
  data?: string
  transactionHash?: string
  blockNumber?: string
  logIndex?: string
}

interface RpcBlock {
  number?: string
  timestamp?: string
  transactions?: Array<string | Record<string, unknown>>
}

function tokenMeta(
  tokens: TokenRecord[],
  contract: string,
): { symbol: string; decimals: number } {
  const hit = tokens.find((item) => (item.contractAddress ?? '').toLowerCase() === contract.toLowerCase())
  return { symbol: hit?.symbol || 'TOKEN', decimals: hit?.decimals ?? 18 }
}

export function parseRpcTransferLog(
  log: unknown,
  address: string,
  tokens: TokenRecord[],
  timestampMs: number,
): HistoryTxDraft | null {
  const row = asRecord(log)
  if (!row) return null
  const topics = Array.isArray(row.topics) ? row.topics.map((item) => asString(item).toLowerCase()) : []
  if (topics[0] !== ERC20_TRANSFER_TOPIC || topics.length !== 3) return null
  const txid = asString(row.transactionHash)
  const contract = asString(row.address)
  const data = asString(row.data)
  if (!txid || !contract || !data) return null
  let amountMinor = 0n
  try {
    amountMinor = BigInt(data)
  } catch {
    return null
  }
  if (amountMinor <= 0n) return null
  const fromAddress = addressFromTopic(topics[1] ?? '')
  const toAddress = addressFromTopic(topics[2] ?? '')
  if (!sameAddress(fromAddress, address) && !sameAddress(toAddress, address)) return null
  const meta = tokenMeta(tokens, contract)
  return {
    txid,
    direction: sameAddress(fromAddress, address) ? 'send' : 'receive',
    fromAddress,
    toAddress,
    amountMinor,
    decimals: meta.decimals,
    symbol: meta.symbol,
    contractAddress: contract,
    feeMinor: null,
    status: 'confirmed',
    blockHeight: parseHexNumber(row.blockNumber),
    timestampMs,
  }
}

export function parseRpcNativeTxs(
  block: unknown,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
): HistoryTxDraft[] {
  const row = asRecord(block)
  if (!row || !Array.isArray(row.transactions)) return []
  const blockHeight = parseHexNumber(row.number)
  const timestampMs = (parseHexNumber(row.timestamp) ?? 0) * 1000
  const drafts: HistoryTxDraft[] = []
  for (const item of row.transactions) {
    const tx = asRecord(item)
    if (!tx) continue
    const txid = asString(tx.hash)
    const fromAddress = asString(tx.from)
    const toAddress = asString(tx.to)
    if (!txid || !fromAddress) continue
    let amountMinor = 0n
    try {
      amountMinor = BigInt(asString(tx.value) || '0')
    } catch {
      continue
    }
    if (amountMinor <= 0n) continue
    if (!sameAddress(fromAddress, address) && !sameAddress(toAddress, address)) continue
    drafts.push({
      txid,
      direction: sameAddress(fromAddress, address) ? 'send' : 'receive',
      fromAddress,
      toAddress,
      amountMinor,
      decimals: nativeDecimals,
      symbol: nativeSymbol,
      contractAddress: null,
      feeMinor: null,
      status: 'confirmed',
      blockHeight,
      timestampMs: timestampMs || Date.now(),
    })
  }
  return drafts
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    const part = await Promise.all(items.slice(i, i + size).map(fn))
    out.push(...part)
  }
  return out
}

async function getLogs(
  network: NetworkRecord,
  from: number,
  to: number,
  topics: Array<string | null>,
): Promise<RpcLog[]> {
  try {
    const rows = await evmRpc<RpcLog[]>(network, 'eth_getLogs', [
      { fromBlock: toBlockHex(from), toBlock: toBlockHex(to), topics },
    ])
    return Array.isArray(rows) ? rows : []
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (to > from && /10000|too many|limit exceeded|query returned more/i.test(message)) {
      const mid = Math.floor((from + to) / 2)
      const [left, right] = await Promise.all([
        getLogs(network, from, mid, topics),
        getLogs(network, mid + 1, to, topics),
      ])
      return [...left, ...right]
    }
    throw err
  }
}

async function blockTimestamps(
  network: NetworkRecord,
  heights: number[],
): Promise<Map<number, number>> {
  const unique = [...new Set(heights.filter((item) => item > 0))]
  const stamps = new Map<number, number>()
  await mapPool(unique, RPC_CONCURRENCY, async (height) => {
    try {
      const block = await evmRpc<RpcBlock>(network, 'eth_getBlockByNumber', [toBlockHex(height), false])
      const ts = parseHexNumber(block?.timestamp)
      if (ts != null) stamps.set(height, ts * 1000)
    } catch {
      /* 时间戳拿不到就用本地时间 */
    }
  })
  return stamps
}

export async function fetchEvmHistoryViaRpc(
  network: NetworkRecord,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
  startBlock: number | null,
  tokens: TokenRecord[],
): Promise<HistoryTxDraft[]> {
  const latest = parseHexNumber(await evmRpc<string>(network, 'eth_blockNumber'))
  if (latest == null) throw new Error('当前节点未返回最新区块')
  const { from, to } = historyBlockWindow(latest, startBlock, MAX_LOG_BLOCKS)
  const topic = topicAddress(address)
  const logs: RpcLog[] = []
  for (let start = from; start <= to; start += LOG_CHUNK) {
    const end = Math.min(to, start + LOG_CHUNK - 1)
    const [outgoing, incoming] = await Promise.all([
      getLogs(network, start, end, [ERC20_TRANSFER_TOPIC, topic]),
      getLogs(network, start, end, [ERC20_TRANSFER_TOPIC, null, topic]),
    ])
    logs.push(...outgoing, ...incoming)
  }

  const seenLogs = new Set<string>()
  const uniqueLogs: RpcLog[] = []
  for (const log of logs) {
    const key = `${asString(log.transactionHash)}:${asString(log.logIndex)}`
    if (seenLogs.has(key)) continue
    seenLogs.add(key)
    uniqueLogs.push(log)
  }

  const heights = uniqueLogs
    .map((log) => parseHexNumber(log.blockNumber))
    .filter((item): item is number => item != null)
  const stamps = await blockTimestamps(network, heights)
  const drafts: HistoryTxDraft[] = []
  for (const log of uniqueLogs) {
    const height = parseHexNumber(log.blockNumber) ?? 0
    const parsed = parseRpcTransferLog(log, address, tokens, stamps.get(height) || Date.now())
    if (parsed) drafts.push(parsed)
  }

  const nativeFrom = nativeScanFrom(
    from,
    to,
    startBlock == null ? FIRST_SYNC_NATIVE_BLOCKS : MAX_NATIVE_BLOCKS,
  )
  const nativeHeights: number[] = []
  for (let height = nativeFrom; height <= to; height += 1) nativeHeights.push(height)
  const blocks = await mapPool(nativeHeights, RPC_CONCURRENCY, async (height) => {
    try {
      return await evmRpc<RpcBlock>(network, 'eth_getBlockByNumber', [toBlockHex(height), true])
    } catch {
      return null
    }
  })
  for (const block of blocks) {
    if (block) drafts.push(...parseRpcNativeTxs(block, address, nativeSymbol, nativeDecimals))
  }
  return drafts
}
