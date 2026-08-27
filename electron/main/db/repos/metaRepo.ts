/**
 * app_meta 与 settings 两张 key-value 表的仓储。
 */
import type { AppSettings } from '../../../../shared/types'
import type { KdfDescriptor } from '../../security/crypto'
import { catalogEnvUrl } from '../../rpc/env'
import { getDatabase } from '../sqlite'

const META_KDF = 'vault.kdf'
const META_VERIFIER = 'vault.verifier'
const META_FIAT_DEFAULTED = 'settings.fiatDefaultedCny'
const SETTINGS_KEY = 'app'

export const DEFAULT_SETTINGS: AppSettings = {
  baseUrl: catalogEnvUrl(),
  autoLockMinutes: 5,
  currencyCode: 'CNY',
  language: 'zh-CN',
  theme: 'dark',
  defaultWalletId: null,
  defaultNetworkPk: null,
  proxyEnabled: false,
}

function readMeta(key: string): string | null {
  const row = getDatabase()
    .prepare<[string], { value: string }>('SELECT value FROM app_meta WHERE key = ?')
    .get(key)
  return row ? row.value : null
}

function writeMeta(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, Date.now())
}

/* --------------------------------- vault --------------------------------- */

export function loadVaultMeta(): { kdf: KdfDescriptor; verifier: string } | null {
  const kdfRaw = readMeta(META_KDF)
  const verifier = readMeta(META_VERIFIER)
  if (!kdfRaw || !verifier) return null
  return { kdf: JSON.parse(kdfRaw) as KdfDescriptor, verifier }
}

export function saveVaultMeta(kdf: KdfDescriptor, verifier: string): void {
  writeMeta(META_KDF, JSON.stringify(kdf))
  writeMeta(META_VERIFIER, verifier)
}

/* -------------------------------- settings -------------------------------- */

export function loadSettings(): AppSettings {
  const row = getDatabase()
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEY)
  if (!row) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(row.value) as Partial<AppSettings> & { proxyUrl?: string }
    const { proxyUrl: _legacy, ...rest } = parsed
    return { ...DEFAULT_SETTINGS, ...rest }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** 旧版单条 proxyUrl，仅用于迁到 proxies 表 */
export function peekLegacyProxyUrl(): string {
  const row = getDatabase()
    .prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
    .get(SETTINGS_KEY)
  if (!row) return ''
  try {
    const parsed = JSON.parse(row.value) as { proxyUrl?: unknown }
    return typeof parsed.proxyUrl === 'string' ? parsed.proxyUrl.trim() : ''
  } catch {
    return ''
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch }
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(SETTINGS_KEY, JSON.stringify(next), Date.now())
  return next
}

/** 实验室钱包默认人民币。仅在从未改过法币时，把旧默认 USD 迁成 CNY。 */
export function ensureDefaultFiat(): void {
  if (readMeta(META_FIAT_DEFAULTED)) return
  if (loadSettings().currencyCode === 'USD') {
    saveSettings({ currencyCode: 'CNY' })
  }
  writeMeta(META_FIAT_DEFAULTED, '1')
}
