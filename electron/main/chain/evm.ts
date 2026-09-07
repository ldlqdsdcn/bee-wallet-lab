/**
 * EVM JSON-RPC 与转账签名。钱包进程直连 Infura / 目录下发的 https RPC。
 */
import {
  bytesToHex,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  type Hex,
  type TransactionSerializable,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { NetworkRecord } from '@shared/types'
import { toChecksumAddress } from '../derive/evm'
import { normalizeChainId } from '../rpc/endpoints'
import { providerPost } from '../rpc/fetch'
import { rpcUrlsForNetwork, selectedRpcNode } from '../rpc/nodes'
import { setPreferredRpc } from '../rpc/preference'

interface JsonRpcResponse<T> {
  result?: T
  error?: { code?: number; message?: string }
}

const workingRpcByNetwork = new Map<string, string>()

export async function evmRpc<T>(network: NetworkRecord, method: string, params: unknown[] = []): Promise<T> {
  const chainId = normalizeChainId(network.chainId)
  const payload = { jsonrpc: '2.0', id: Date.now(), method, params }

  const call = async (url: string): Promise<T> => {
    const body = await providerPost<JsonRpcResponse<T>>(url, payload)
    if (body?.error) throw new Error(body.error.message || `RPC ${method} 失败`)
    return body.result as T
  }

  const remember = (url: string) => {
    workingRpcByNetwork.set(network.id, url)
    setPreferredRpc(network.id, url)
  }

  const urls = rpcUrlsForNetwork(network)
  if (urls.length === 0) {
    throw new Error(`网络 ${network.networkName || chainId} 没有可用的 RPC`)
  }

  let failedPrimary: string | undefined
  const pinned = selectedRpcNode(network.id)?.url
  if (pinned) {
    try {
      const result = await call(pinned)
      remember(pinned)
      return result
    } catch {
      workingRpcByNetwork.delete(network.id)
      failedPrimary = pinned
    }
  } else {
    const cached = workingRpcByNetwork.get(network.id)
    if (cached && urls.includes(cached)) {
      try {
        return await call(cached)
      } catch {
        workingRpcByNetwork.delete(network.id)
        failedPrimary = cached
      }
    }
  }

  const rest = urls.filter((url) => url !== failedPrimary)
  const racePool = rest.length > 0 ? rest : urls

  try {
    const winner = await raceFirst(
      racePool.map(async (url) => {
        const result = await call(url)
        return { url, result }
      }),
    )
    remember(winner.url)
    return winner.result
  } catch (err) {
    throw err instanceof Error ? err : new Error(`RPC ${method} 失败`)
  }
}

function raceFirst<T>(tasks: Array<Promise<T>>): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = tasks.length
    let firstError: Error | null = null
    if (pending === 0) {
      reject(new Error('没有可用的 RPC'))
      return
    }
    for (const task of tasks) {
      task.then(resolve, (err: unknown) => {
        if (!firstError) firstError = err instanceof Error ? err : new Error(String(err))
        pending -= 1
        if (pending === 0 && firstError) reject(firstError)
      })
    }
  })
}

function toHexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex
}

function parseQuantity(value: string | number | bigint | null | undefined): bigint {
  if (value == null) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  return BigInt(value)
}

export async function getEvmBalance(network: NetworkRecord, address: string): Promise<bigint> {
  const result = await evmRpc<string>(network, 'eth_getBalance', [address, 'latest'])
  return parseQuantity(result)
}

export async function getErc20Balance(
  network: NetworkRecord,
  contract: string,
  address: string,
): Promise<bigint> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [address as Hex] })
  const result = await evmRpc<string>(network, 'eth_call', [{ to: contract, data }, 'latest'])
  return parseQuantity(result)
}

export interface EvmFeeQuote {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  gasPrice: bigint | null
  eip1559: boolean
}

export async function quoteEvmFees(network: NetworkRecord): Promise<Record<'low' | 'medium' | 'high', EvmFeeQuote>> {
  const gasPrice = parseQuantity(await evmRpc<string>(network, 'eth_gasPrice'))
  let tip = gasPrice / 10n
  try {
    tip = parseQuantity(await evmRpc<string>(network, 'eth_maxPriorityFeePerGas'))
  } catch {
    /* 老链没有 EIP-1559 */
  }
  const scaled = (base: bigint, numerator: number) => (base * BigInt(numerator)) / 100n
  return {
    low: { maxFeePerGas: scaled(gasPrice, 90), maxPriorityFeePerGas: tip, gasPrice: scaled(gasPrice, 90), eip1559: tip > 0n },
    medium: { maxFeePerGas: gasPrice, maxPriorityFeePerGas: tip, gasPrice, eip1559: tip > 0n },
    high: { maxFeePerGas: scaled(gasPrice, 130), maxPriorityFeePerGas: scaled(tip || 1n, 150), gasPrice: scaled(gasPrice, 130), eip1559: tip > 0n },
  }
}

export async function estimateEvmGas(input: {
  network: NetworkRecord
  from: string
  to?: string | null
  value: bigint
  data?: Hex
}): Promise<bigint> {
  const result = await evmRpc<string>(input.network, 'eth_estimateGas', [
    {
      from: input.from,
      ...(input.to ? { to: input.to } : {}),
      value: toHexQuantity(input.value),
      ...(input.data ? { data: input.data } : {}),
    },
  ])
  return (parseQuantity(result) * 120n) / 100n
}

export async function getEvmNonce(network: NetworkRecord, address: string): Promise<number> {
  return Number(parseQuantity(await evmRpc<string>(network, 'eth_getTransactionCount', [address, 'pending'])))
}

export function encodeErc20Transfer(to: string, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [toChecksumAddress(to) as Hex, amount],
  })
}

export async function signAndSerializeEvmTx(input: {
  privateKey: Uint8Array
  chainId: number
  nonce: number
  to?: string | null
  value: bigint
  data?: Hex
  gasLimit: bigint
  fee: EvmFeeQuote
}): Promise<{ hex: string; hash: string }> {
  // viem bytesToHex 已带 0x；再拼一层会变成 0x0x…，noble 会报 invalid private key
  const account = privateKeyToAccount(bytesToHex(input.privateKey))
  const to = input.to ? (input.to as Hex) : undefined
  const tx: TransactionSerializable = input.fee.eip1559
    ? {
        type: 'eip1559',
        chainId: input.chainId,
        nonce: input.nonce,
        to,
        value: input.value,
        data: input.data,
        gas: input.gasLimit,
        maxFeePerGas: input.fee.maxFeePerGas,
        maxPriorityFeePerGas: input.fee.maxPriorityFeePerGas,
      }
    : {
        type: 'legacy',
        chainId: input.chainId,
        nonce: input.nonce,
        to,
        value: input.value,
        data: input.data,
        gas: input.gasLimit,
        gasPrice: input.fee.gasPrice ?? input.fee.maxFeePerGas,
      }
  const signed = await account.signTransaction(tx)
  return { hex: signed, hash: keccak256(signed as Hex) }
}

export async function fetchEvmReceipt(network: NetworkRecord, txid: string): Promise<unknown> {
  return evmRpc<unknown>(network, 'eth_getTransactionReceipt', [txid])
}

export async function waitForEvmReceipt(
  network: NetworkRecord,
  txid: string,
  timeoutMs = 45_000,
): Promise<unknown | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = await fetchEvmReceipt(network, txid)
    if (receipt) return receipt
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  return null
}

export async function broadcastEvmTx(network: NetworkRecord, rawHex: string): Promise<string> {
  const hash = await evmRpc<string>(network, 'eth_sendRawTransaction', [rawHex])
  if (!hash) throw new Error('广播成功但未返回交易哈希')
  return hash
}

const EVM_EXPLORER: Record<string, string> = {
  '1': 'https://etherscan.io',
  '11155111': 'https://sepolia.etherscan.io',
  '42161': 'https://arbiscan.io',
  '421614': 'https://sepolia.arbiscan.io',
  '56': 'https://bscscan.com',
  '97': 'https://testnet.bscscan.com',
  '8453': 'https://basescan.org',
  '84532': 'https://sepolia.basescan.org',
  '10': 'https://optimistic.etherscan.io',
  '137': 'https://polygonscan.com',
  '43114': 'https://snowtrace.io',
  '59144': 'https://lineascan.build',
  '534352': 'https://scrollscan.com',
  '324': 'https://explorer.zksync.io',
  '81457': 'https://blastscan.io',
  '5000': 'https://mantlescan.xyz',
  '3721': 'https://xonescan.com',
}

export function explorerUrlForEvm(txid: string, browser: string | null, chainId?: string): string | null {
  if (browser) return `${browser.replace(/\/+$/, '')}/tx/${txid}`
  const base = chainId ? EVM_EXPLORER[chainId] : null
  return base ? `${base}/tx/${txid}` : null
}
