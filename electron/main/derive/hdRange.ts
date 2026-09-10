/**
 * 按当前链批量派生分层地址。secp 链先算到 change 层再非硬化展开；
 * Solana 先算到 account' 再硬化展开 address'。
 */
import { HDKey } from '@scure/bip32'
import { bytesToHex } from '@noble/hashes/utils'
import type { BitcoinAddressType, NetworkScope, WalletType } from '@shared/types'
import { buildPath, resolveAddressType } from './paths'
import { bitcoinAddressFromPublicKey, privateKeyToWif } from './bitcoin'
import { evmAddressFromPrivateKey, evmPublicKeyHex } from './evm'
import { encodeSolanaSecretKey, solanaAddressFromPrivateKey, solanaPublicKeyHex } from './solana'
import { tronAddressFromPrivateKey } from './tron'
import { slip10DeriveHardenedChild, slip10DeriveNode } from './slip10'

export const HD_RANGE_MAX = 20_000

export interface HdRangeInput {
  seed: Uint8Array
  walletType: WalletType
  networkScope: NetworkScope
  addressType?: BitcoinAddressType | null
  accountIndex?: number
  fromIndex: number
  toIndex: number
  skipIndexes?: Iterable<number>
}

export interface HdRangeRow {
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

export function normalizeHdRange(fromIndex: number, toIndex: number): { fromIndex: number; toIndex: number } {
  const from = requireIndex('起始序号', fromIndex)
  const to = requireIndex('结束序号', toIndex)
  if (to < from) throw new Error('结束序号不能小于起始序号')
  if (to - from + 1 > HD_RANGE_MAX) throw new Error(`一次最多生成 ${HD_RANGE_MAX} 个地址`)
  return { fromIndex: from, toIndex: to }
}

function parentPathOf(fullPath: string): string {
  return fullPath.replace(/\/\d+'?$/, '')
}

function encodeKey(
  walletType: WalletType,
  networkScope: NetworkScope,
  addressType: BitcoinAddressType | null,
  privateKey: Uint8Array,
  compressedPublicKey: Uint8Array,
): Omit<HdRangeRow, 'index' | 'path'> {
  switch (walletType) {
    case 'bitcoin':
      if (!addressType) throw new Error('bitcoin 必须指定地址格式')
      return {
        address: bitcoinAddressFromPublicKey(compressedPublicKey, addressType, networkScope),
        publicKey: bytesToHex(compressedPublicKey),
        privateKey: privateKeyToWif(privateKey, networkScope),
      }
    case 'web3':
      return {
        address: evmAddressFromPrivateKey(privateKey),
        publicKey: evmPublicKeyHex(privateKey),
        privateKey: `0x${bytesToHex(privateKey)}`,
      }
    case 'tron':
      return {
        address: tronAddressFromPrivateKey(privateKey),
        publicKey: evmPublicKeyHex(privateKey),
        privateKey: `0x${bytesToHex(privateKey)}`,
      }
    case 'solana':
      return {
        address: solanaAddressFromPrivateKey(privateKey),
        publicKey: solanaPublicKeyHex(privateKey),
        privateKey: encodeSolanaSecretKey(privateKey),
      }
  }
}

export function deriveHdRange(input: HdRangeInput): HdRangeRow[] {
  const accountIndex = requireIndex('accountIndex', input.accountIndex ?? 0)
  const { fromIndex, toIndex } = normalizeHdRange(input.fromIndex, input.toIndex)
  const addressType = resolveAddressType(input.walletType, input.addressType)
  const skip = input.skipIndexes ? new Set(input.skipIndexes) : null
  const sample = buildPath({
    walletType: input.walletType,
    networkScope: input.networkScope,
    addressType,
    accountIndex,
    addressIndex: 0,
  })
  const parentPath = parentPathOf(sample)
  const rows: HdRangeRow[] = []

  if (input.walletType === 'solana') {
    const parent = slip10DeriveNode(input.seed, parentPath)
    try {
      for (let index = fromIndex; index <= toIndex; index += 1) {
        if (skip?.has(index)) continue
        const child = slip10DeriveHardenedChild(parent, index)
        rows.push({
          index,
          path: `${parentPath}/${index}'`,
          ...encodeKey('solana', input.networkScope, null, child.key, child.key),
        })
      }
    } finally {
      parent.key.fill(0)
      parent.chainCode.fill(0)
    }
    return rows
  }

  const master = HDKey.fromMasterSeed(input.seed)
  const parent = master.derive(parentPath)
  try {
    if (!parent.privateKey) throw new Error(`路径 ${parentPath} 没有派生出私钥`)
    for (let index = fromIndex; index <= toIndex; index += 1) {
      if (skip?.has(index)) continue
      const child = parent.deriveChild(index)
      try {
        const privateKey = child.privateKey
        const publicKey = child.publicKey
        if (!privateKey || !publicKey) throw new Error(`路径 ${parentPath}/${index} 没有派生出私钥`)
        rows.push({
          index,
          path: `${parentPath}/${index}`,
          ...encodeKey(input.walletType, input.networkScope, addressType, privateKey, publicKey),
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
