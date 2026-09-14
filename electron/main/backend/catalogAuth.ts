/**
 * 目录站机器身份：本机专用 EVM 私钥，只用来 POST /auth/authenticate。
 * 第一次启动时生成，不跟主密码绑定，类似设备 UUID；不出现在钱包列表。
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { evmAddressFromPrivateKey } from '../derive/evm'
import { personalSign } from '../sign/evm'
import { wipe } from '../security/crypto'
import { getBaseUrl } from './config'
import {
  decryptCatalogAuthPrivateKey,
  deleteCatalogAuthKey,
  loadCatalogAuthKeyRow,
  saveCatalogAuthKey,
} from '../db/repos/catalogAuthKeyRepo'
import { getToken, setAuthIdentityProvider, type AuthIdentity } from './auth'

export function generateCatalogAuthSecret(): { address: string; privateKeyHex: string } {
  const privateKey = secp256k1.utils.randomPrivateKey()
  try {
    return {
      address: evmAddressFromPrivateKey(privateKey),
      privateKeyHex: `0x${bytesToHex(privateKey)}`,
    }
  } finally {
    wipe(privateKey)
  }
}

export function ensureCatalogAuthKey(): { address: string } {
  const existing = loadCatalogAuthKeyRow()
  if (existing) {
    try {
      decryptCatalogAuthPrivateKey(existing)
      return { address: existing.address }
    } catch {
      deleteCatalogAuthKey()
    }
  }
  const secret = generateCatalogAuthSecret()
  try {
    saveCatalogAuthKey(secret)
    console.log('[catalog] 已生成本机鉴权地址', secret.address)
    return { address: secret.address }
  } finally {
    secret.privateKeyHex = ''
  }
}

export function getCatalogAuthIdentity(): AuthIdentity {
  const row = loadCatalogAuthKeyRow()
  if (!row) {
    const created = ensureCatalogAuthKey()
    return getCatalogAuthIdentityFromAddress(created.address)
  }
  return getCatalogAuthIdentityFromAddress(row.address)
}

function getCatalogAuthIdentityFromAddress(address: string): AuthIdentity {
  return {
    address,
    sign: (message) => {
      const row = loadCatalogAuthKeyRow()
      if (!row) throw new Error('还没有目录站鉴权私钥')
      const hex = decryptCatalogAuthPrivateKey(row)
      const key = hexToBytes(hex.replace(/^0x/, ''))
      try {
        return personalSign(key, message)
      } finally {
        wipe(key)
      }
    },
  }
}

/** 启动时调用：没有 JWT 或已过期就重签一次并落盘。目录站没填则跳过。 */
export async function refreshCatalogAuthToken(): Promise<void> {
  if (!getBaseUrl()) return
  ensureCatalogAuthKey()
  await getToken()
}

export function initCatalogAuth(): void {
  setAuthIdentityProvider(() => getCatalogAuthIdentity())
}
