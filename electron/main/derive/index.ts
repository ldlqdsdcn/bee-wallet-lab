/**
 * 派生内核统一入口。主进程唯一允许接触私钥的层，向上只暴露地址与公钥。
 *
 * 使用约定：
 *   1. seed 与 privateKey 都是 Uint8Array，调用方用完必须 wipe；
 *   2. derive() 返回私钥，deriveAddress() 不返回，能用后者就别用前者；
 *   3. publicKey 输出口径与移动端一致：bitcoin 为 33 字节压缩 hex，
 *      web3 / tron 为 0x 前缀的 65 字节未压缩 hex。
 */
import { HDKey } from '@scure/bip32'
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { BitcoinAddressType, DerivedAddress, NetworkScope, WalletType } from '@shared/types'
import { assertPath, buildPath, resolveAddressType, type PathInput } from './paths'
import { bitcoinAddressFromPublicKey, wifToPrivateKey } from './bitcoin'
import { evmAddressFromPrivateKey, evmPublicKeyHex } from './evm'
import { tronAddressFromPrivateKey } from './tron'

export * from './paths'
export * from './mnemonic'
export * from './bitcoin'
export * from './evm'
export * from './tron'

export interface DeriveInput extends PathInput {
  seed: Uint8Array
  /** 高级模式：直接指定完整路径，忽略 accountIndex / addressIndex */
  customPath?: string
}

/** 带私钥的派生结果，调用方用完必须 wipe privateKey */
export interface DerivedKey extends DerivedAddress {
  privateKey: Uint8Array
}

export interface ImportKeyInput {
  walletType: WalletType
  networkScope: NetworkScope
  addressType?: BitcoinAddressType | null
  /** hex（可带 0x）或 BTC 的 WIF */
  privateKey: string
}

export interface ImportedKey {
  walletType: WalletType
  networkScope: NetworkScope
  addressType: BitcoinAddressType | null
  address: string
  publicKey: string
  privateKey: Uint8Array
}

function addressFor(
  walletType: WalletType,
  networkScope: NetworkScope,
  addressType: BitcoinAddressType | null,
  privateKey: Uint8Array,
  compressedPublicKey: Uint8Array,
): { address: string; publicKey: string } {
  switch (walletType) {
    case 'bitcoin':
      if (!addressType) throw new Error('bitcoin 账户必须指定地址格式')
      return {
        address: bitcoinAddressFromPublicKey(compressedPublicKey, addressType, networkScope),
        publicKey: bytesToHex(compressedPublicKey),
      }
    case 'web3':
      return {
        address: evmAddressFromPrivateKey(privateKey),
        publicKey: evmPublicKeyHex(privateKey),
      }
    case 'tron':
      return {
        address: tronAddressFromPrivateKey(privateKey),
        publicKey: evmPublicKeyHex(privateKey),
      }
  }
}

export function derive(input: DeriveInput): DerivedKey {
  const addressType = resolveAddressType(input.walletType, input.addressType)
  const rootPath = input.customPath ? assertPath(input.customPath) : buildPath(input)

  const master = HDKey.fromMasterSeed(input.seed)
  const node = master.derive(rootPath)
  try {
    const { privateKey, publicKey } = node
    if (!privateKey || !publicKey) {
      throw new Error(`路径 ${rootPath} 没有派生出私钥`)
    }
    const derived = addressFor(
      input.walletType,
      input.networkScope,
      addressType,
      privateKey,
      publicKey,
    )
    return {
      walletType: input.walletType,
      networkScope: input.networkScope,
      addressType,
      rootPath,
      accountIndex: input.accountIndex ?? 0,
      addressIndex: input.addressIndex ?? 0,
      address: derived.address,
      publicKey: derived.publicKey,
      // node.privateKey 是内部缓冲的引用，wipePrivateData 会清零，必须拷贝一份
      privateKey: Uint8Array.from(privateKey),
    }
  } finally {
    node.wipePrivateData()
    master.wipePrivateData()
  }
}

/** 只要地址，不要私钥 */
export function deriveAddress(input: DeriveInput): DerivedAddress {
  const { privateKey, ...rest } = derive(input)
  privateKey.fill(0)
  return rest
}

/** 导入私钥（无助记词），rootPath 为 null 由调用方落库 */
export function deriveFromPrivateKey(input: ImportKeyInput): ImportedKey {
  const addressType = resolveAddressType(input.walletType, input.addressType)
  const raw = input.privateKey.trim()

  let privateKey: Uint8Array
  let networkScope = input.networkScope
  if (input.walletType === 'bitcoin' && !/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) {
    const parsed = wifToPrivateKey(raw)
    privateKey = parsed.privateKey
    networkScope = parsed.networkScope
  } else {
    const body = raw.replace(/^0x/, '')
    if (!/^[0-9a-fA-F]{64}$/.test(body)) {
      throw new Error('私钥格式不合法，应为 64 位 hex 或 BTC 的 WIF')
    }
    privateKey = hexToBytes(body.toLowerCase())
  }

  const compressed = secp256k1.getPublicKey(privateKey, true)
  const derived = addressFor(input.walletType, networkScope, addressType, privateKey, compressed)
  return {
    walletType: input.walletType,
    networkScope,
    addressType,
    address: derived.address,
    publicKey: derived.publicKey,
    privateKey,
  }
}
