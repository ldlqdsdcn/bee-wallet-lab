/**
 * 固定总量 ERC-20 部署数据。合约已预编译，这里只拼构造参数。
 */
import { encodeDeployData, type Abi, type Hex } from 'viem'
import { asRecord, asString } from '../backend/list'
import { toChecksumAddress } from '../derive/evm'
import { parseDecimalToMinor } from '../util/amount'
import { invalidArg } from '../ipc/registry'
import artifact from './beeFixedErc20.json'

export const DEFAULT_TOKEN_SUPPLY = '1000000000'
export const DEFAULT_TOKEN_DECIMALS = 18

export interface NormalizedIssue {
  name: string
  symbol: string
  decimals: number
  supply: string
  supplyMinor: bigint
}

export function normalizeIssueFields(
  input: {
    name?: string
    symbol?: string
    decimals?: number
    supply?: string
  },
  opts?: {
    maxDecimals?: number
    maxSupplyMinor?: bigint
    defaultDecimals?: number
    maxNameLength?: number
    maxSymbolLength?: number
  },
): NormalizedIssue {
  const maxName = opts?.maxNameLength ?? 64
  const maxSymbol = opts?.maxSymbolLength ?? 16
  const name = (input.name ?? '').trim()
  if (name.length < 1 || name.length > maxName) throw invalidArg(`代币名称需要 1 到 ${maxName} 个字符`)
  const symbol = (input.symbol ?? '').trim().toUpperCase()
  if (!new RegExp(`^[A-Z0-9]{1,${maxSymbol}}$`).test(symbol)) {
    throw invalidArg(`代币符号需为 1 到 ${maxSymbol} 位字母或数字`)
  }
  const maxDecimals = opts?.maxDecimals ?? 18
  const decimals = Number(input.decimals ?? opts?.defaultDecimals ?? DEFAULT_TOKEN_DECIMALS)
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > maxDecimals) {
    throw invalidArg(`精度需为 0 到 ${maxDecimals} 的整数`)
  }
  const supply = (input.supply ?? DEFAULT_TOKEN_SUPPLY).trim()
  let supplyMinor: bigint
  try {
    supplyMinor = parseDecimalToMinor(supply, decimals)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : '发行总量不合法')
  }
  if (supplyMinor <= 0n) throw invalidArg('发行总量必须大于 0')
  if (opts?.maxSupplyMinor != null && supplyMinor > opts.maxSupplyMinor) {
    throw invalidArg('发行总量超过链上允许的最大值')
  }
  return { name, symbol, decimals, supply, supplyMinor }
}

export function encodeFixedErc20Deploy(input: NormalizedIssue): Hex {
  return encodeDeployData({
    abi: artifact.abi as Abi,
    bytecode: artifact.bytecode as Hex,
    args: [input.name, input.symbol, input.decimals, input.supplyMinor],
  })
}

export function parseCreatedContract(payload: unknown): string | null {
  const address = asString(asRecord(payload)?.contractAddress)
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0+$/i.test(address)) return null
  return toChecksumAddress(address)
}

export function artifactBytecode(): Hex {
  return artifact.bytecode as Hex
}
