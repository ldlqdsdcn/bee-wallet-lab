/**
 * EVM 交易历史：优先 Blockscout 公开 API，其次 Etherscan 兼容接口。
 */
import type { NetworkRecord } from '@shared/types'
import { asRecord, asString } from '../backend/list'
import { providerGet } from '../rpc/fetch'
import { etherscanApiKey } from '../rpc/env'
import { normalizeChainId } from '../rpc/endpoints'
import {
  parseBlockscoutTokenTransfers,
  parseBlockscoutTransactions,
  parseEtherscanTokentx,
  parseEtherscanTxlist,
} from './parse'
import type { HistoryTxDraft } from './types'

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
  return providerGet<unknown>(url)
}

function etherscanOk(payload: unknown): boolean {
  const root = asRecord(payload)
  if (!root) return false
  const status = asString(root.status)
  const message = asString(root.message).toLowerCase()
  if (status === '1') return true
  return message.includes('no transaction') || message.includes('no record')
}

async function fromBlockscout(
  network: NetworkRecord,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
): Promise<HistoryTxDraft[] | null> {
  const base = blockscoutBase(network)
  if (!base) return null
  try {
    const txs = await getJson(
      `${base}/api/v2/addresses/${encodeURIComponent(address)}/transactions?filter=to%20%7C%20from`,
    )
    const tokens = await getJson(
      `${base}/api/v2/addresses/${encodeURIComponent(address)}/token-transfers?type=ERC-20`,
    ).catch(() => ({ items: [] }))
    return [
      ...parseBlockscoutTransactions(txs, address, nativeSymbol, nativeDecimals),
      ...parseBlockscoutTokenTransfers(tokens, address),
    ]
  } catch {
    return null
  }
}

async function etherscanQuery(apiBase: string, query: string): Promise<unknown> {
  const key = etherscanApiKey()
  const apikey = key ? `&apikey=${encodeURIComponent(key)}` : ''
  return getJson(`${apiBase}?${query}${apikey}`)
}

async function fromEtherscan(
  network: NetworkRecord,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
): Promise<HistoryTxDraft[] | null> {
  const chainId = normalizeChainId(network.chainId)
  const key = etherscanApiKey()
  try {
    if (key) {
      const base = 'https://api.etherscan.io/v2/api'
      const native = await etherscanQuery(
        base,
        `chainid=${chainId}&module=account&action=txlist&address=${address}&page=1&offset=50&sort=desc`,
      )
      if (!etherscanOk(native)) return null
      const tokens = await etherscanQuery(
        base,
        `chainid=${chainId}&module=account&action=tokentx&address=${address}&page=1&offset=50&sort=desc`,
      ).catch(() => ({ status: '1', result: [] }))
      return [
        ...parseEtherscanTxlist(native, address, nativeSymbol, nativeDecimals),
        ...parseEtherscanTokentx(tokens, address),
      ]
    }
    const v1 = ETHERSCAN_V1[chainId]
    if (!v1) return null
    const native = await etherscanQuery(
      v1,
      `module=account&action=txlist&address=${address}&page=1&offset=50&sort=desc`,
    )
    if (!etherscanOk(native)) return null
    const tokens = await etherscanQuery(
      v1,
      `module=account&action=tokentx&address=${address}&page=1&offset=50&sort=desc`,
    ).catch(() => ({ status: '1', result: [] }))
    return [
      ...parseEtherscanTxlist(native, address, nativeSymbol, nativeDecimals),
      ...parseEtherscanTokentx(tokens, address),
    ]
  } catch {
    return null
  }
}

export async function fetchEvmHistory(
  network: NetworkRecord,
  address: string,
  nativeSymbol: string,
  nativeDecimals: number,
): Promise<HistoryTxDraft[]> {
  const blockscout = await fromBlockscout(network, address, nativeSymbol, nativeDecimals)
  if (blockscout) return blockscout
  const etherscan = await fromEtherscan(network, address, nativeSymbol, nativeDecimals)
  if (etherscan) return etherscan
  throw new Error(
    `无法从公开浏览器同步 ${network.networkName} 的交易。可在 .env 填写 VITE_ETHERSCAN_API_KEY，或在网络维护里填 Blockscout 浏览器地址`,
  )
}
