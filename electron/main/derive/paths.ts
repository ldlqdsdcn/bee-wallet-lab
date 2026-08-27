/**
 * BIP-44 家族派生路径。
 * 口径与移动端 onewallet-app 完全一致（src/domains/network/bitcoinAddressTypeMetadata.ts）：
 *   BTC 四种地址格式分别走 BIP-44 / 49 / 84 / 86，测试网 coin_type = 1；
 *   EVM 固定 m/44'/60'/...，TRON 固定 m/44'/195'/...（TRON 不区分主网测试网路径）。
 *
 * 移动端只用 accountIndex 替换路径最后一段，等价于本项目的 addressIndex；
 * 本项目额外开放第三层 account'（accountIndex），两者都为 0 时与移动端根路径逐字符相同。
 */
import type { BitcoinAddressType, NetworkScope, WalletType } from '@shared/types'

export const BITCOIN_ADDRESS_TYPES: readonly BitcoinAddressType[] = [
  'p2pkh',
  'p2sh-p2wpkh',
  'p2wpkh',
  'p2tr',
]

export const DEFAULT_BITCOIN_ADDRESS_TYPE: BitcoinAddressType = 'p2wpkh'

/** 地址格式 -> BIP purpose */
const BITCOIN_PURPOSE: Record<BitcoinAddressType, number> = {
  p2pkh: 44,
  'p2sh-p2wpkh': 49,
  p2wpkh: 84,
  p2tr: 86,
}

/** SLIP-44 coin_type */
const COIN_TYPE: Record<WalletType, Record<NetworkScope, number>> = {
  bitcoin: { mainnet: 0, testnet: 1 },
  web3: { mainnet: 60, testnet: 60 },
  tron: { mainnet: 195, testnet: 195 },
  solana: { mainnet: 501, testnet: 501 },
}

/** 只接受 m 开头的非负整数路径，允许 ' 或 h 表示硬化 */
const PATH_SHAPE = /^m(\/\d+['h]?)*$/

/** BIP-32 非硬化索引上限 */
const MAX_INDEX = 0x7fffffff

export interface PathInput {
  walletType: WalletType
  networkScope: NetworkScope
  /** 仅 bitcoin 有意义；不传时用默认格式 */
  addressType?: BitcoinAddressType | null
  accountIndex?: number
  addressIndex?: number
}

/** 非 bitcoin 链一律返回 null，避免脏数据落库 */
export function resolveAddressType(
  walletType: WalletType,
  addressType?: BitcoinAddressType | null,
): BitcoinAddressType | null {
  if (walletType !== 'bitcoin') return null
  const value = addressType ?? DEFAULT_BITCOIN_ADDRESS_TYPE
  if (!BITCOIN_ADDRESS_TYPES.includes(value)) {
    throw new Error(`unsupported bitcoin address type: ${value}`)
  }
  return value
}

function assertIndex(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_INDEX) {
    throw new Error(`${name} 必须是 0 ~ ${MAX_INDEX} 之间的整数`)
  }
  return value
}

export function buildPath(input: PathInput): string {
  const accountIndex = assertIndex('accountIndex', input.accountIndex ?? 0)
  const addressIndex = assertIndex('addressIndex', input.addressIndex ?? 0)
  const addressType = resolveAddressType(input.walletType, input.addressType)
  const purpose = addressType ? BITCOIN_PURPOSE[addressType] : 44
  const coinType = COIN_TYPE[input.walletType]?.[input.networkScope]
  if (coinType === undefined) {
    throw new Error(`unsupported wallet type: ${input.walletType}`)
  }
  if (input.walletType === 'solana') {
    return `m/44'/501'/${accountIndex}'/${addressIndex}'`
  }
  return `m/${purpose}'/${coinType}'/${accountIndex}'/0/${addressIndex}`
}

/** 高级模式的自定义路径校验，返回规范化后的路径 */
export function assertPath(path: string): string {
  const normalized = path.trim().replace(/h/g, "'")
  if (!PATH_SHAPE.test(normalized)) {
    throw new Error(`派生路径格式不合法：${path}`)
  }
  for (const segment of normalized.split('/').slice(1)) {
    assertIndex('派生路径层级', Number.parseInt(segment, 10))
  }
  return normalized
}
