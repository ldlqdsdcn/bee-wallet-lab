/**
 * 设备级封装密钥。不跟主密码绑定，启动时就能加解密目录站身份和 JWT。
 * 只挡住直接打开数据库看到明文；能读 userData 的人仍能还原。
 */
import { createHash } from 'node:crypto'
import { decryptSecret, encryptSecret } from '../security/crypto'

const LABEL = 'bee-wallet-lab/device-wrap/v1'

function wrapKek(): Buffer {
  return createHash('sha256').update(LABEL).digest()
}

export function encryptDeviceSecret(plaintext: string, aad: string): string {
  return encryptSecret(wrapKek(), plaintext, aad)
}

export function decryptDeviceSecret(packed: string, aad: string): string {
  return decryptSecret(wrapKek(), packed, aad)
}
