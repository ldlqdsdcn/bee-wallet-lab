/**
 * Bitcoin 地址与私钥编码。四种格式：
 *   p2pkh        Legacy         BIP-44   1... / m...n...
 *   p2sh-p2wpkh  Nested SegWit  BIP-49   3... / 2...
 *   p2wpkh       Native SegWit  BIP-84   bc1q... / tb1q...
 *   p2tr         Taproot        BIP-86   bc1p... / tb1p...
 */
import * as btc from '@scure/btc-signer'
import type { BitcoinAddressType, NetworkScope } from '@shared/types'

type BtcNetwork = typeof btc.NETWORK

function networkOf(scope: NetworkScope): BtcNetwork {
  return scope === 'mainnet' ? btc.NETWORK : btc.TEST_NETWORK
}

/** Taproot 的 internal key 是 32 字节 x-only，需要去掉压缩公钥的前导字节 */
function toXOnly(publicKey: Uint8Array): Uint8Array {
  return publicKey.length === 32 ? publicKey : publicKey.subarray(1, 33)
}

export function bitcoinAddressFromPublicKey(
  publicKey: Uint8Array,
  addressType: BitcoinAddressType,
  networkScope: NetworkScope,
): string {
  const network = networkOf(networkScope)
  let address: string | undefined
  switch (addressType) {
    case 'p2pkh':
      address = btc.p2pkh(publicKey, network).address
      break
    case 'p2sh-p2wpkh':
      address = btc.p2sh(btc.p2wpkh(publicKey, network), network).address
      break
    case 'p2wpkh':
      address = btc.p2wpkh(publicKey, network).address
      break
    case 'p2tr':
      address = btc.p2tr(toXOnly(publicKey), undefined, network).address
      break
  }
  if (!address) throw new Error(`无法生成 ${addressType} 地址`)
  return address
}

/** 私钥导出为 WIF（压缩公钥格式） */
export function privateKeyToWif(privateKey: Uint8Array, networkScope: NetworkScope): string {
  return btc.WIF(networkOf(networkScope)).encode(privateKey)
}

/**
 * 解析 WIF。主网与测试网前缀不同，用哪个网络解出来就返回哪个，
 * 避免用户把测试网私钥导入成主网账户。
 */
export function wifToPrivateKey(wif: string): {
  privateKey: Uint8Array
  networkScope: NetworkScope
} {
  const scopes: NetworkScope[] = ['mainnet', 'testnet']
  for (const networkScope of scopes) {
    try {
      return { privateKey: btc.WIF(networkOf(networkScope)).decode(wif.trim()), networkScope }
    } catch {
      continue
    }
  }
  throw new Error('WIF 私钥格式不合法')
}

/** 校验地址是否属于指定网络（解析失败即为非法） */
export function isBitcoinAddress(address: string, networkScope: NetworkScope): boolean {
  try {
    btc.Address(networkOf(networkScope)).decode(address.trim())
    return true
  } catch {
    return false
  }
}
