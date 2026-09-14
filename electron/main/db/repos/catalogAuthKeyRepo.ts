/**
 * 目录站鉴权私钥。不进钱包列表，不跟主密码绑定，类似本机设备身份。
 */
import { decryptDeviceSecret, encryptDeviceSecret } from '../../backend/deviceWrap'
import { getDatabase } from '../sqlite'

export const CATALOG_AUTH_KEY_ID = 'default'
export const CATALOG_AUTH_AAD = 'catalog-auth:default'

export interface CatalogAuthKeyRow {
  id: string
  address: string
  encryptedPrivateKey: string
  createdAt: number
}

interface Row {
  id: string
  address: string
  encrypted_private_key: string
  created_at: number
}

function toRecord(row: Row): CatalogAuthKeyRow {
  return {
    id: row.id,
    address: row.address,
    encryptedPrivateKey: row.encrypted_private_key,
    createdAt: row.created_at,
  }
}

export function loadCatalogAuthKeyRow(): CatalogAuthKeyRow | null {
  const row = getDatabase()
    .prepare<[string], Row>('SELECT * FROM catalog_auth_keys WHERE id = ?')
    .get(CATALOG_AUTH_KEY_ID)
  return row ? toRecord(row) : null
}

export function saveCatalogAuthKey(input: { address: string; privateKeyHex: string }): CatalogAuthKeyRow {
  const now = Date.now()
  const encrypted = encryptDeviceSecret(input.privateKeyHex, CATALOG_AUTH_AAD)
  getDatabase()
    .prepare(
      `INSERT INTO catalog_auth_keys (id, address, encrypted_private_key, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         address = excluded.address,
         encrypted_private_key = excluded.encrypted_private_key`,
    )
    .run(CATALOG_AUTH_KEY_ID, input.address, encrypted, now)
  return {
    id: CATALOG_AUTH_KEY_ID,
    address: input.address,
    encryptedPrivateKey: encrypted,
    createdAt: now,
  }
}

export function decryptCatalogAuthPrivateKey(row: CatalogAuthKeyRow): string {
  return decryptDeviceSecret(row.encryptedPrivateKey, CATALOG_AUTH_AAD)
}

export function deleteCatalogAuthKey(): void {
  getDatabase().prepare('DELETE FROM catalog_auth_keys WHERE id = ?').run(CATALOG_AUTH_KEY_ID)
}
