/**
 * EVM 交易历史：当前 RPC 节点（Infura 等）优先增量同步，浏览器接口兜底。
 * 本地已有记录时从最后一条的区块往后拉，不从头扫链。
 */
import type { NetworkRecord } from '@shared/types'
import { asRecord, asString } from '../backend/list'
import { listTokens } from '../db/repos/catalogRepo'
import { providerGet } from '../rpc/fetch'
import { etherscanApiKey } from '../rpc/env'
import { normalizeChainId } from '../rpc/endpoints'
import { fetchEvmHistoryViaRpc } from './evmNode'
import {
  parseBlockscoutTokenTransfers,
  parseBlockscoutTransactions,
  parseEtherscanTokentx,
  parseEtherscanTxlist,
} from './parse'
import { buildAccountTxQuery, etherscanMessage, filterHistoryFromBlock, isDeprecatedV1 } from './range'
import type { HistoryTxDraft } from './types'

const EXPLORER_TIMEOUT_MS = 8_000
const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api'

const BLOCKSCOUT: Record<string, string> = {
  '1': 'https://eth.blockscout.com',
  '11155111': 'https://eth-sepolia.blockscout.com',
  '10': 'https://optimism.blockscout.com',
  '8453': 'https://base.blockscout.com',
  '84532': 'https://base-sepolia.blockscout.com',
  '42161': 'https://arbitrum.blockscout.com',
  '421614': 'https://arbitrum-sepolia.blockscout.com',
  '137': 'https://polygon.blockscout.com',
  '56': 'https://bsc.blockscout.com',
  '534352': 'https://scroll.blockscout.com',
  '81457': 'https://blast.blockscout.com',
  '324': 'https://zksync.blockscout.com',
  '100': 'https://gnosis.blockscout.com',
  '59144': 'https://explorer.linea.build',
}

const ETHERSCAN_V1: Record<string, string> = {
  '1': 'https://api.etherscan.io/api',
  '11155111': 'https://api-sepolia.etherscan.io/api',
  '56': 'https://api.bscscan.com/api',
  '97': 'https://api-testnet.bscscan.com/api',
  '42161': 'https://api.arbiscan.io/api',
  '8453': 'https://api.basescan.org/api',
  '84532': 'https://api-sepolia.basescan.org/api',
  '10': 'https://api-optimistic.etherscan.io/api',
  '137': 'https://api.polygonscan.com/api',
  '43114': 'https://api.snowtrace.io/api',
}

function blockscoutBase(network: NetworkRecord): string | null {
  const chainId = normalizeChainId(network.chainId)
  if (BLOCKSCOUT[chainId]) return BLOCKSCOUT[chainId]
  const browser = network.browser?.trim()
  if (!browser) return null
  try {
    return new URL(browser).origin
  } catch {
    return null
  }
}

async function getJson(url: string): Promise<unknown> {
  return providerGet<unknown>(url, undefined, EXPLORER_TIMEOUT_MS)
}

function etherscanOk(payload: unknown): boolean {
  const root = asRecord(payload)
  if (!root) return false
  if (isDeprecatedV1(payload)) return false
  const status = asString(root.status)
  const message = asString(root.message).toLowerCase()
  if (status === '1') return true
  return message.includes('no transaction') || message.includes('no record')
}

async function etherscanQuery(apiBase: string, query: string): Promise<unknown> {
  const key = etherscanApiKey()
  const apikey = key ? `&apikey=${encodeURIComponent(key)}` : ''
  const joiner = apiBase.includes('?') ? '&' : '?'
  return getJson(`${apiBase}${joiner}${query}${apikey}`)
}

async function fetchEtherscanPages(
  request: (page: number) => Promise<unknown>,
  parse: (payload: unknown) => HistoryTxDraft[],
  incremental: boolean,
): Promise<HistoryTxDraft[]> {
  const out: HistoryTxDraft[] = []
  const maxPages = incremental ? 8 : 1
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await request(page)
    if (isDeprecatedV1(payload)) throw new Error(etherscanMessage(payload))
    if (!etherscanOk(payload)) {
      if (page === 1) throw new Error(etherscanMessage(payload))
      break
    }
    const rows = parse(payload)
    out.push(...rows)
    if (rows.length < (incremental ? 100 : 50)) break
  }
  return out
}

async function fromEtherscanCompat(
  apiBase: string,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
  startBlock: number | null,
  chainId?: string,
): Promise<HistoryTxDraft[]> {
  const native = await fetchEtherscanPages(
    (page) => etherscanQuery(apiBase, buildAccountTxQuery({ action: 'txlist', address, startBlock, chainId, page })),
    (payload) => parseEtherscanTxlist(payload, address, nativeSymbol, nativeDecimals),
    startBlock != null,
  )
  const tokens = await fetchEtherscanPages(
    (page) => etherscanQuery(apiBase, buildAccountTxQuery({ action: 'tokentx', address, startBlock, chainId, page })),
    (payload) => parseEtherscanTokentx(payload, address),
    startBlock != null,
  ).catch(() => [])
  return [...native, ...tokens]
}

async function fromBlockscoutV2(
  network: NetworkRecord,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
  startBlock: number | null,
): Promise<HistoryTxDraft[]> {
  const base = blockscoutBase(network)
  if (!base) throw new Error('未配置 Blockscout 地址')
  const txs = await getJson(
    `${base}/api/v2/addresses/${encodeURIComponent(address)}/transactions?filter=to%20%7C%20from`,
  )
  const tokens = await getJson(
    `${base}/api/v2/addresses/${encodeURIComponent(address)}/token-transfers?type=ERC-20`,
  ).catch(() => ({ items: [] }))
  return filterHistoryFromBlock(
    [
      ...parseBlockscoutTransactions(txs, address, nativeSymbol, nativeDecimals),
      ...parseBlockscoutTokenTransfers(tokens, address),
    ],
    startBlock,
  )
}

export async function fetchEvmHistory(
  network: NetworkRecord,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
  startBlock: number | null = null,
): Promise<HistoryTxDraft[]> {
  const chainId = normalizeChainId(network.chainId)
  const errors: string[] = []
  const trySource = async (label: string, run: () => Promise<HistoryTxDraft[]>): Promise<HistoryTxDraft[] | null> => {
    try {
      return filterHistoryFromBlock(await run(), startBlock)
    } catch (err) {
      errors.push(`${label}：${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  const node = await trySource('当前节点', () =>
    fetchEvmHistoryViaRpc(network, address, nativeSymbol, nativeDecimals, startBlock, listTokens(network.id)),
  )
  if (node) return node

  const key = etherscanApiKey()
  if (key) {
    const v2 = await trySource('Etherscan V2', () =>
      fromEtherscanCompat(ETHERSCAN_V2, address, nativeSymbol, nativeDecimals, startBlock, chainId),
    )
    if (v2) return v2
  }

  const v1Base = ETHERSCAN_V1[chainId]
  if (v1Base) {
    const v1 = await trySource('浏览器 V1', () =>
      fromEtherscanCompat(v1Base, address, nativeSymbol, nativeDecimals, startBlock),
    )
    if (v1) return v1
    if (errors.some((item) => /deprecated v1|api v2/i.test(item))) {
      const v2 = await trySource('Etherscan V2', () =>
        fromEtherscanCompat(ETHERSCAN_V2, address, nativeSymbol, nativeDecimals, startBlock, chainId),
      )
      if (v2) return v2
    }
  } else if (!key) {
    const v2 = await trySource('Etherscan V2', () =>
      fromEtherscanCompat(ETHERSCAN_V2, address, nativeSymbol, nativeDecimals, startBlock, chainId),
    )
    if (v2) return v2
  }

  const scout = blockscoutBase(network)
  if (scout) {
    const compat = await trySource('Blockscout', () =>
      fromEtherscanCompat(`${scout}/api`, address, nativeSymbol, nativeDecimals, startBlock),
    )
    if (compat) return compat
    const v2 = await trySource('Blockscout v2', () =>
      fromBlockscoutV2(network, address, nativeSymbol, nativeDecimals, startBlock),
    )
    if (v2) return v2
  }

  const hint = errors[0] ?? '当前节点不可用'
  throw new Error(`无法同步 ${network.networkName} 的交易（${hint}）。请检查当前 RPC 节点是否可用`)
}
