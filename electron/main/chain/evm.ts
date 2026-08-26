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
import { resolveEvmRpcUrl } from '../rpc/endpoints'
import { providerPost } from '../rpc/fetch'

interface JsonRpcResponse<T> {
  result?: T
  error?: { code?: number; message?: string }
}

export async function evmRpc<T>(network: NetworkRecord, method: string, params: unknown[] = []): Promise<T> {
  const url = resolveEvmRpcUrl(network)
  const payload = { jsonrpc: '2.0', id: Date.now(), method, params }
  const body = await providerPost<JsonRpcResponse<T>>(url, payload)
  if (body?.error) throw new Error(body.error.message || `RPC ${method} 失败`)
  return body.result as T
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
  to: string
  value: bigint
  data?: Hex
}): Promise<bigint> {
  const result = await evmRpc<string>(input.network, 'eth_estimateGas', [
    {
      from: input.from,
      to: input.to,
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
  to: string
  value: bigint
  data?: Hex
  gasLimit: bigint
  fee: EvmFeeQuote
}): Promise<{ hex: string; hash: string }> {
  const account = privateKeyToAccount(`0x${bytesToHex(input.privateKey)}`)
  const tx: TransactionSerializable = input.fee.eip1559
    ? {
        type: 'eip1559',
        chainId: input.chainId,
        nonce: input.nonce,
        to: input.to as Hex,
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
        to: input.to as Hex,
        value: input.value,
        data: input.data,
        gas: input.gasLimit,
        gasPrice: input.fee.gasPrice ?? input.fee.maxFeePerGas,
      }
  const signed = await account.signTransaction(tx)
  return { hex: signed, hash: keccak256(signed as Hex) }
}

export async function broadcastEvmTx(network: NetworkRecord, rawHex: string): Promise<string> {
  const hash = await evmRpc<string>(network, 'eth_sendRawTransaction', [rawHex])
  if (!hash) throw new Error('广播成功但未返回交易哈希')
  return hash
}

export function explorerUrlForEvm(txid: string, browser: string | null): string | null {
  if (!browser) return null
  return `${browser.replace(/\/+$/, '')}/tx/${txid}`
}
