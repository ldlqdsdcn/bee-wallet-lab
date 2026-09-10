/**
 * 合约地址规范化。不访问节点。
 */
import type { WalletType } from '@shared/types'
import { isEvmAddress, toChecksumAddress } from '../derive/evm'
import { isTronAddress, tronAddressFromEvmAddress } from '../derive/tron'

export function normalizeContractAddress(walletType: WalletType, address: string): string {
  const trimmed = address.trim()
  if (!trimmed) throw new Error('合约地址不能为空')
  if (walletType === 'web3') {
    if (!isEvmAddress(trimmed)) throw new Error('合约地址不是有效的 EVM 地址')
    return toChecksumAddress(trimmed)
  }
  if (walletType === 'tron') {
    if (isTronAddress(trimmed)) return trimmed
    if (isEvmAddress(trimmed)) return tronAddressFromEvmAddress(trimmed)
    throw new Error('合约地址不是有效的 TRON 地址')
  }
  throw new Error('当前网络不支持合约交互，请切换到 EVM 或 TRON')
}
