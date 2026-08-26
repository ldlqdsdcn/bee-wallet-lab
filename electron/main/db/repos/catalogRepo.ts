/**
 * 目录仓储：网络 / 代币 / 法币快照 + 同步元信息。
 */
import type {
  CatalogSyncMeta,
  CurrencyRecord,
  NetworkRecord,
  NetworkScope,
  TokenRecord,
  WalletType,
} from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface NetworkRow {
  id: string
  network_id: string
  network_name: string
  chain_id: string
  chain_name: string
  chain_type: string | null
  wallet_type: string
  network_scope: string
  coin_id: string | null
  coin_easy: string | null
  rpc_url: string | null
  browser: string | null
  icon: string | null
  web_address: string | null
  support_gas_time: string | null
  remark: string | null
  sort_order: number
  synced_at: number
}

interface TokenRow {
  id: string
  network_pk: string
  token_id: string | null
  name: string | null
  symbol: string
  decimals: number
  contract_address: string | null
  token_standard: string | null
  is_token: number
  gas_limit: number | null
  token_icon: string | null
  blockchain_explorer: string | null
  is_default_selected: number
  sort_order: number
  synced_at: number
}

interface CurrencyRow {
  id: string
  code: string
  name: string | null
  symbol: string | null
  rate: string | null
  synced_at: number
}

interface SyncMetaRow {
  name: string
  last_sync_at: number | null
  item_count: number
  last_error: string | null
}

export function toNetworkRecord(row: NetworkRow): NetworkRecord {
  return {
    id: row.id,
    networkId: row.network_id,
    networkName: row.network_name,
    chainId: row.chain_id,
    chainName: row.chain_name,
    chainType: row.chain_type,
    walletType: row.wallet_type as WalletType,
    coinId: row.coin_id,
    coinEasy: row.coin_easy,
    rpcUrl: row.rpc_url,
    browser: row.browser,
    icon: row.icon,
    webAddress: row.web_address,
    supportGasTime: row.support_gas_time,
    remark: row.remark,
    networkScope: row.network_scope as NetworkScope,
    syncedAt: row.synced_at,
  }
}

export function toTokenRecord(row: TokenRow): TokenRecord {
  return {
    id: row.id,
    tokenId: row.token_id,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    contractAddress: row.contract_address,
    tokenStandard: row.token_standard,
    isToken: row.is_token === 1,
    gasLimit: row.gas_limit,
    networkPk: row.network_pk,
    tokenIcon: row.token_icon,
    blockchainExplorer: row.blockchain_explorer,
    isDefaultSelected: row.is_default_selected === 1,
    syncedAt: row.synced_at,
  }
}

export function toCurrencyRecord(row: CurrencyRow): CurrencyRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    symbol: row.symbol,
    syncedAt: row.synced_at,
  }
}

export function listNetworks(): NetworkRecord[] {
  return getDatabase()
    .prepare<[], NetworkRow>(
      'SELECT * FROM catalog_networks ORDER BY sort_order ASC, network_name ASC',
    )
    .all()
    .map(toNetworkRecord)
}

export function getNetwork(id: string): NetworkRecord | null {
  const row = getDatabase()
    .prepare<[string], NetworkRow>('SELECT * FROM catalog_networks WHERE id = ?')
    .get(id)
  return row ? toNetworkRecord(row) : null
}

export function listTokens(networkPk?: string): TokenRecord[] {
  const db = getDatabase()
  const rows = networkPk
    ? db
        .prepare<[string], TokenRow>(
          'SELECT * FROM catalog_tokens WHERE network_pk = ? ORDER BY is_token ASC, sort_order ASC, symbol ASC',
        )
        .all(networkPk)
    : db
        .prepare<[], TokenRow>(
          'SELECT * FROM catalog_tokens ORDER BY network_pk, is_token ASC, sort_order ASC, symbol ASC',
        )
        .all()
  return rows.map(toTokenRecord)
}

export function getToken(id: string): TokenRecord | null {
  const row = getDatabase()
    .prepare<[string], TokenRow>('SELECT * FROM catalog_tokens WHERE id = ?')
    .get(id)
  return row ? toTokenRecord(row) : null
}

export function listCurrencies(): CurrencyRecord[] {
  return getDatabase()
    .prepare<[], CurrencyRow>('SELECT * FROM catalog_currencies ORDER BY code ASC')
    .all()
    .map(toCurrencyRecord)
}

export function getSyncMeta(name: string): CatalogSyncMeta | null {
  const row = getDatabase()
    .prepare<[string], SyncMetaRow>('SELECT * FROM catalog_sync_meta WHERE name = ?')
    .get(name)
  if (!row) return null
  return {
    name: row.name,
    lastSyncAt: row.last_sync_at,
    itemCount: row.item_count,
    lastError: row.last_error,
  }
}

export function upsertSyncMeta(meta: CatalogSyncMeta): void {
  getDatabase()
    .prepare(
      `INSERT INTO catalog_sync_meta (name, last_sync_at, item_count, last_error)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         last_sync_at = excluded.last_sync_at,
         item_count = excluded.item_count,
         last_error = excluded.last_error`,
    )
    .run(meta.name, meta.lastSyncAt, meta.itemCount, meta.lastError)
}

export function replaceNetworks(records: NetworkRecord[]): void {
  const db = getDatabase()
  const upsert = db.prepare(
    `INSERT INTO catalog_networks (
       id, network_id, network_name, chain_id, chain_name, chain_type, wallet_type,
       network_scope, coin_id, coin_easy, rpc_url, browser, icon, web_address,
       support_gas_time, remark, sort_order, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       network_id = excluded.network_id,
       network_name = excluded.network_name,
       chain_id = excluded.chain_id,
       chain_name = excluded.chain_name,
       chain_type = excluded.chain_type,
       wallet_type = excluded.wallet_type,
       network_scope = excluded.network_scope,
       coin_id = excluded.coin_id,
       coin_easy = excluded.coin_easy,
       rpc_url = excluded.rpc_url,
       browser = excluded.browser,
       icon = excluded.icon,
       web_address = excluded.web_address,
       support_gas_time = excluded.support_gas_time,
       remark = excluded.remark,
       sort_order = excluded.sort_order,
       synced_at = excluded.synced_at`,
  )
  const keep = new Set(records.map((item) => item.id))
  const apply = db.transaction(() => {
    records.forEach((item, index) => {
      upsert.run(
        item.id,
        item.networkId,
        item.networkName,
        item.chainId,
        item.chainName,
        item.chainType,
        item.walletType,
        item.networkScope,
        item.coinId,
        item.coinEasy,
        item.rpcUrl,
        item.browser,
        item.icon,
        item.webAddress,
        item.supportGasTime,
        item.remark,
        index,
        item.syncedAt,
      )
    })
    const existing = db.prepare<[], { id: string }>('SELECT id FROM catalog_networks').all()
    const drop = db.prepare('DELETE FROM catalog_networks WHERE id = ?')
    for (const row of existing) {
      if (!keep.has(row.id)) drop.run(row.id)
    }
  })
  apply()
}

export function replaceTokens(records: TokenRecord[]): void {
  const db = getDatabase()
  const upsert = db.prepare(
    `INSERT INTO catalog_tokens (
       id, network_pk, token_id, name, symbol, decimals, contract_address, token_standard,
       is_token, gas_limit, token_icon, blockchain_explorer, is_default_selected, sort_order, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       network_pk = excluded.network_pk,
       token_id = excluded.token_id,
       name = excluded.name,
       symbol = excluded.symbol,
       decimals = excluded.decimals,
       contract_address = excluded.contract_address,
       token_standard = excluded.token_standard,
       is_token = excluded.is_token,
       gas_limit = excluded.gas_limit,
       token_icon = excluded.token_icon,
       blockchain_explorer = excluded.blockchain_explorer,
       is_default_selected = excluded.is_default_selected,
       sort_order = excluded.sort_order,
       synced_at = excluded.synced_at`,
  )
  const keep = new Set(records.map((item) => item.id))
  const apply = db.transaction(() => {
    records.forEach((item, index) => {
      upsert.run(
        item.id,
        item.networkPk,
        item.tokenId,
        item.name,
        item.symbol,
        item.decimals,
        item.contractAddress,
        item.tokenStandard,
        item.isToken ? 1 : 0,
        item.gasLimit,
        item.tokenIcon,
        item.blockchainExplorer,
        item.isDefaultSelected ? 1 : 0,
        index,
        item.syncedAt,
      )
    })
    const existing = db.prepare<[], { id: string }>('SELECT id FROM catalog_tokens').all()
    const drop = db.prepare('DELETE FROM catalog_tokens WHERE id = ?')
    for (const row of existing) {
      if (!keep.has(row.id)) drop.run(row.id)
    }
  })
  apply()
}

export function replaceCurrencies(records: CurrencyRecord[]): void {
  const db = getDatabase()
  const upsert = db.prepare(
    `INSERT INTO catalog_currencies (id, code, name, symbol, rate, synced_at)
     VALUES (?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       code = excluded.code,
       name = excluded.name,
       symbol = excluded.symbol,
       synced_at = excluded.synced_at`,
  )
  const keep = new Set(records.map((item) => item.id))
  const apply = db.transaction(() => {
    for (const item of records) {
      upsert.run(item.id, item.code, item.name, item.symbol, item.syncedAt)
    }
    const existing = db.prepare<[], { id: string }>('SELECT id FROM catalog_currencies').all()
    const drop = db.prepare('DELETE FROM catalog_currencies WHERE id = ?')
    for (const row of existing) {
      if (!keep.has(row.id)) drop.run(row.id)
    }
  })
  apply()
}
