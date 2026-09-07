/**
 * 批量派生 EVM 分层地址。先算出 m/44'/60'/{account}'/0，再对每个 addressIndex 做一次非硬化子密钥。
 */
import { HDKey } from '@scure/bip32'
import { bytesToHex } from '@noble/hashes/utils'
import { evmAddressFromPrivateKey, evmPublicKeyHex } from './evm'

export const EVM_RANGE_MAX = 20_000

export interface EvmRangeInput {
  seed: Uint8Array
  accountIndex?: number
  fromIndex: number
  toIndex: number
  skipIndexes?: Iterable<number>
}

export interface EvmRangeRow {
  index: number
  path: string
  address: string
  publicKey: string
  privateKey: string
}

function requireIndex(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new Error(`${name} 必须是 0 到 ${0x7fffffff} 的整数`)
  }
  return value
}

export function normalizeEvmRange(fromIndex: number, toIndex: number): { fromIndex: number; toIndex: number } {
  const from = requireIndex('起始序号', fromIndex)
  const to = requireIndex('结束序号', toIndex)
  if (to < from) throw new Error('结束序号不能小于起始序号')
  if (to - from + 1 > EVM_RANGE_MAX) throw new Error(`一次最多生成 ${EVM_RANGE_MAX} 个地址`)
  return { fromIndex: from, toIndex: to }
}

export function deriveEvmRange(input: EvmRangeInput): EvmRangeRow[] {
  const accountIndex = requireIndex('accountIndex', input.accountIndex ?? 0)
  const { fromIndex, toIndex } = normalizeEvmRange(input.fromIndex, input.toIndex)
  const skip = input.skipIndexes ? new Set(input.skipIndexes) : null
  const parentPath = `m/44'/60'/${accountIndex}'/0`
  const master = HDKey.fromMasterSeed(input.seed)
  const parent = master.derive(parentPath)
  const rows: EvmRangeRow[] = []
  try {
    if (!parent.privateKey) throw new Error(`路径 ${parentPath} 没有派生出私钥`)
    for (let index = fromIndex; index <= toIndex; index += 1) {
      if (skip?.has(index)) continue
      const child = parent.deriveChild(index)
      try {
        const privateKey = child.privateKey
        if (!privateKey) throw new Error(`路径 ${parentPath}/${index} 没有派生出私钥`)
        rows.push({
          index,
          path: `${parentPath}/${index}`,
          address: evmAddressFromPrivateKey(privateKey),
          publicKey: evmPublicKeyHex(privateKey),
          privateKey: `0x${bytesToHex(privateKey)}`,
        })
      } finally {
        child.wipePrivateData()
      }
    }
    return rows
  } finally {
    parent.wipePrivateData()
    master.wipePrivateData()
  }
}
