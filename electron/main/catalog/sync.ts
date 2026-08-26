/**
 * 目录同步：第一版只装入内置 JSON 到 SQLite，不请求后台。
 */
import {
  listCurrencies,
  listNetworks,
  listTokens,
  replaceCurrencies,
  replaceNetworks,
  replaceTokens,
  upsertSyncMeta,
} from '../db/repos/catalogRepo'
import { loadSettings, saveSettings } from '../db/repos/metaRepo'
import { loadBuiltinCatalog } from './builtin'
import type { CatalogSyncResult } from '@shared/types'

function applyBuiltin(now: number): CatalogSyncResult {
  const { networks, tokens, currencies } = loadBuiltinCatalog(now)
  replaceNetworks(networks)
  replaceTokens(tokens)
  replaceCurrencies(currencies)
  upsertSyncMeta({ name: 'all', lastSyncAt: now, itemCount: networks.length + tokens.length, lastError: null })
  upsertSyncMeta({ name: 'networks', lastSyncAt: now, itemCount: networks.length, lastError: null })
  upsertSyncMeta({ name: 'tokens', lastSyncAt: now, itemCount: tokens.length, lastError: null })
  upsertSyncMeta({ name: 'currencies', lastSyncAt: now, itemCount: currencies.length, lastError: null })

  const settings = loadSettings()
  if (!settings.defaultNetworkPk && networks[0]) {
    const preferred =
      networks.find((item) => item.walletType === 'web3' && item.networkScope === 'mainnet') ?? networks[0]
    saveSettings({ defaultNetworkPk: preferred.id })
  }

  return {
    networks: networks.length,
    tokens: tokens.length,
    currencies: currencies.length,
    offline: false,
    error: null,
    syncedAt: now,
  }
}

export async function syncCatalog(force = false): Promise<CatalogSyncResult> {
  void force
  return applyBuiltin(Date.now())
}

export function getCatalogNetworks() {
  return listNetworks()
}

export function getCatalogTokens(networkPk?: string) {
  return listTokens(networkPk)
}

export function getCatalogCurrencies() {
  const rows = listCurrencies()
  return rows.length ? rows : [{ id: 'usd', code: 'USD', name: 'US Dollar', symbol: '$', syncedAt: 0 }]
}
