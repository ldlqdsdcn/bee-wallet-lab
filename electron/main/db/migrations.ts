/**
 * 数据库迁移。
 *
 * 约定：
 * - 版本号写在 `PRAGMA user_version`，逐版本顺序执行，全部包在一个事务里
 * - 只做加法（新增表 / 新增列 / 新增索引），不改已有列语义
 * - 助记词、passphrase、私钥、JWT 一律以 AES-256-GCM 密文入库，明文永不落盘
 */
import type { AppDatabase } from './sqlite'

interface Migration {
  version: number
  description: string
  up: (db: AppDatabase) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'initial schema: vault / wallets / accounts / catalog / balances / transactions',
    up: (db) => {
      db.exec(`
        -- 应用级元数据：KDF 描述、主密码校验值、schema 标记等
        CREATE TABLE app_meta (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- 用户设置（单条 key-value，便于后续加字段）
        CREATE TABLE settings (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- 钱包（助记词容器）
        CREATE TABLE wallets (
          id                   TEXT PRIMARY KEY,
          name                 TEXT NOT NULL,
          mnemonic_length      INTEGER NOT NULL,
          -- AES-256-GCM 密文，AAD = wallet id
          encrypted_mnemonic   TEXT NOT NULL,
          encrypted_passphrase TEXT,
          has_passphrase       INTEGER NOT NULL DEFAULT 0,
          -- 助记词指纹（BIP32 根 fingerprint），用于导入去重
          fingerprint          TEXT,
          is_default           INTEGER NOT NULL DEFAULT 0,
          is_auth_wallet       INTEGER NOT NULL DEFAULT 0,
          created_at           INTEGER NOT NULL,
          updated_at           INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_wallets_fingerprint ON wallets(fingerprint) WHERE fingerprint IS NOT NULL;

        -- 账户（派生地址或导入私钥）
        CREATE TABLE accounts (
          id                    TEXT PRIMARY KEY,
          -- 导入私钥的账户 wallet_id 为 NULL
          wallet_id             TEXT REFERENCES wallets(id) ON DELETE CASCADE,
          wallet_type           TEXT NOT NULL CHECK (wallet_type IN ('bitcoin','web3','tron')),
          network_scope         TEXT NOT NULL CHECK (network_scope IN ('mainnet','testnet')),
          address_type          TEXT CHECK (address_type IN ('p2pkh','p2sh-p2wpkh','p2wpkh','p2tr')),
          root_path             TEXT,
          account_index         INTEGER NOT NULL DEFAULT 0,
          address_index         INTEGER NOT NULL DEFAULT 0,
          address               TEXT NOT NULL,
          public_key            TEXT NOT NULL,
          label                 TEXT,
          source                TEXT NOT NULL CHECK (source IN ('hd','imported')),
          -- 仅 source='imported' 时存在
          encrypted_private_key TEXT,
          created_at            INTEGER NOT NULL,
          updated_at            INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_accounts_addr
          ON accounts(wallet_type, network_scope, address);
        CREATE INDEX idx_accounts_wallet ON accounts(wallet_id);
        CREATE INDEX idx_accounts_lookup ON accounts(wallet_type, network_scope, address_type);

        -- 后端 JWT 缓存（密文），按鉴权地址唯一
        CREATE TABLE auth_tokens (
          address         TEXT PRIMARY KEY,
          base_url        TEXT NOT NULL,
          encrypted_token TEXT NOT NULL,
          issued_at       INTEGER NOT NULL,
          expires_at      INTEGER NOT NULL
        );

        -- 网络目录（后端 /api/network/list 快照）
        CREATE TABLE catalog_networks (
          id               TEXT PRIMARY KEY,
          network_id       TEXT NOT NULL,
          network_name     TEXT NOT NULL,
          chain_id         TEXT NOT NULL,
          chain_name       TEXT NOT NULL,
          chain_type       TEXT,
          wallet_type      TEXT NOT NULL,
          network_scope    TEXT NOT NULL,
          coin_id          TEXT,
          coin_easy        TEXT,
          rpc_url          TEXT,
          browser          TEXT,
          icon             TEXT,
          web_address      TEXT,
          support_gas_time TEXT,
          remark           TEXT,
          sort_order       INTEGER NOT NULL DEFAULT 0,
          synced_at        INTEGER NOT NULL
        );
        CREATE INDEX idx_networks_scope ON catalog_networks(wallet_type, network_scope);

        -- 代币目录（后端 /api/token/list 快照）
        CREATE TABLE catalog_tokens (
          id                  TEXT PRIMARY KEY,
          network_pk          TEXT NOT NULL,
          token_id            TEXT,
          name                TEXT,
          symbol              TEXT NOT NULL,
          decimals            INTEGER NOT NULL DEFAULT 18,
          -- "0" 或 NULL 表示原生币
          contract_address    TEXT,
          token_standard      TEXT,
          is_token            INTEGER NOT NULL DEFAULT 0,
          gas_limit           INTEGER,
          token_icon          TEXT,
          blockchain_explorer TEXT,
          is_default_selected INTEGER NOT NULL DEFAULT 0,
          sort_order          INTEGER NOT NULL DEFAULT 0,
          synced_at           INTEGER NOT NULL
        );
        CREATE INDEX idx_tokens_network ON catalog_tokens(network_pk);

        -- 法币目录
        CREATE TABLE catalog_currencies (
          id        TEXT PRIMARY KEY,
          code      TEXT NOT NULL UNIQUE,
          name      TEXT,
          symbol    TEXT,
          rate      TEXT,
          synced_at INTEGER NOT NULL
        );

        -- 目录同步元信息，支持增量与离线降级
        CREATE TABLE catalog_sync_meta (
          name         TEXT PRIMARY KEY,
          last_sync_at INTEGER,
          item_count   INTEGER NOT NULL DEFAULT 0,
          last_error   TEXT
        );

        -- 余额缓存，key 与 AssetEntry.key 一致
        CREATE TABLE balances_cache (
          entry_key        TEXT PRIMARY KEY,
          network_pk       TEXT NOT NULL,
          token_pk         TEXT NOT NULL,
          account_id       TEXT,
          address          TEXT,
          address_type     TEXT,
          balance          TEXT NOT NULL DEFAULT '0',
          unconfirmed      TEXT,
          currency_code    TEXT,
          currency_balance TEXT,
          updated_at       INTEGER NOT NULL
        );
        CREATE INDEX idx_balances_network ON balances_cache(network_pk);
        CREATE INDEX idx_balances_account ON balances_cache(account_id);

        -- 本地交易记录
        CREATE TABLE transactions (
          id                   TEXT PRIMARY KEY,
          network_pk           TEXT NOT NULL,
          account_id           TEXT NOT NULL,
          txid                 TEXT NOT NULL,
          direction            TEXT NOT NULL CHECK (direction IN ('send','receive')),
          from_address         TEXT NOT NULL,
          to_address           TEXT NOT NULL,
          token_pk             TEXT,
          symbol               TEXT NOT NULL,
          amount               TEXT NOT NULL,
          fee                  TEXT,
          status               TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
          block_height         INTEGER,
          raw_hex              TEXT,
          submitted_to_backend INTEGER NOT NULL DEFAULT 0,
          explorer_url         TEXT,
          created_at           INTEGER NOT NULL,
          updated_at           INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_tx_unique ON transactions(network_pk, txid, account_id);
        CREATE INDEX idx_tx_account ON transactions(account_id, created_at DESC);
      `)
    },
  },
  {
    version: 2,
    description: 'address book',
    up: (db) => {
      db.exec(`
        -- 地址簿：只存公开信息，不涉密钥，因此不加密
        CREATE TABLE address_book (
          id            TEXT PRIMARY KEY,
          label         TEXT NOT NULL,
          wallet_type   TEXT NOT NULL CHECK (wallet_type IN ('bitcoin','web3','tron')),
          network_scope TEXT NOT NULL CHECK (network_scope IN ('mainnet','testnet')),
          -- NULL 表示适用于该链同环境的全部网络
          network_pk    TEXT,
          network_name  TEXT,
          address       TEXT NOT NULL,
          memo          TEXT,
          last_used_at  INTEGER,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        -- 同一链、同一环境、同一网络下地址不重复（network_pk 为 NULL 时归为空串参与去重）
        CREATE UNIQUE INDEX idx_address_book_unique
          ON address_book(wallet_type, network_scope, IFNULL(network_pk, ''), address);
        CREATE INDEX idx_address_book_sort ON address_book(last_used_at DESC, updated_at DESC);
      `)
    },
  },
  {
    version: 3,
    description: 'wallet name index for picker search',
    up: (db) => {
      db.exec('CREATE INDEX IF NOT EXISTS idx_wallets_name ON wallets(name)')
    },
  },
  {
    version: 4,
    description: 'per-network rpc node list',
    up: (db) => {
      db.exec(`
        CREATE TABLE rpc_nodes (
          id              TEXT PRIMARY KEY,
          network_pk      TEXT NOT NULL,
          url             TEXT NOT NULL,
          label           TEXT,
          source          TEXT NOT NULL CHECK (source IN ('builtin','custom')),
          is_selected     INTEGER NOT NULL DEFAULT 0,
          last_latency_ms INTEGER,
          last_error      TEXT,
          last_checked_at INTEGER,
          created_at      INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_rpc_nodes_url ON rpc_nodes(network_pk, url);
        CREATE INDEX idx_rpc_nodes_network ON rpc_nodes(network_pk, is_selected DESC);
      `)
    },
  },
  {
    version: 5,
    description: 'allow solana wallet_type on accounts and address book',
    up: (db) => {
      db.exec(`
        CREATE TABLE accounts_v5 (
          id                    TEXT PRIMARY KEY,
          wallet_id             TEXT REFERENCES wallets(id) ON DELETE CASCADE,
          wallet_type           TEXT NOT NULL CHECK (wallet_type IN ('bitcoin','web3','tron','solana')),
          network_scope         TEXT NOT NULL CHECK (network_scope IN ('mainnet','testnet')),
          address_type          TEXT CHECK (address_type IN ('p2pkh','p2sh-p2wpkh','p2wpkh','p2tr')),
          root_path             TEXT,
          account_index         INTEGER NOT NULL DEFAULT 0,
          address_index         INTEGER NOT NULL DEFAULT 0,
          address               TEXT NOT NULL,
          public_key            TEXT NOT NULL,
          label                 TEXT,
          source                TEXT NOT NULL CHECK (source IN ('hd','imported')),
          encrypted_private_key TEXT,
          created_at            INTEGER NOT NULL,
          updated_at            INTEGER NOT NULL
        );
        INSERT INTO accounts_v5 SELECT * FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_v5 RENAME TO accounts;
        CREATE UNIQUE INDEX idx_accounts_addr
          ON accounts(wallet_type, network_scope, address);
        CREATE INDEX idx_accounts_wallet ON accounts(wallet_id);
        CREATE INDEX idx_accounts_lookup ON accounts(wallet_type, network_scope, address_type);

        CREATE TABLE address_book_v5 (
          id            TEXT PRIMARY KEY,
          label         TEXT NOT NULL,
          wallet_type   TEXT NOT NULL CHECK (wallet_type IN ('bitcoin','web3','tron','solana')),
          network_scope TEXT NOT NULL CHECK (network_scope IN ('mainnet','testnet')),
          network_pk    TEXT,
          network_name  TEXT,
          address       TEXT NOT NULL,
          memo          TEXT,
          last_used_at  INTEGER,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        INSERT INTO address_book_v5 SELECT * FROM address_book;
        DROP TABLE address_book;
        ALTER TABLE address_book_v5 RENAME TO address_book;
        CREATE UNIQUE INDEX idx_address_book_unique
          ON address_book(wallet_type, network_scope, IFNULL(network_pk, ''), address);
        CREATE INDEX idx_address_book_sort ON address_book(last_used_at DESC, updated_at DESC);
      `)
    },
  },
  {
    version: 6,
    description: 'user proxy list',
    up: (db) => {
      db.exec(`
        CREATE TABLE proxies (
          id              TEXT PRIMARY KEY,
          url             TEXT NOT NULL UNIQUE,
          label           TEXT,
          is_selected     INTEGER NOT NULL DEFAULT 0,
          last_latency_ms INTEGER,
          last_error      TEXT,
          last_checked_at INTEGER,
          created_at      INTEGER NOT NULL
        );
        CREATE INDEX idx_proxies_selected ON proxies(is_selected DESC, created_at ASC);
      `)
    },
  },
  {
    version: 7,
    description: 'catalog source builtin/custom so user networks and tokens survive sync',
    up: (db) => {
      db.exec(`
        ALTER TABLE catalog_networks ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin';
        ALTER TABLE catalog_tokens ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin';
      `)
    },
  },
  {
    version: 8,
    description: 'testnet faucet URL list, builtin/custom for later catalog sync',
    up: (db) => {
      db.exec(`
        CREATE TABLE faucets (
          id         TEXT PRIMARY KEY,
          network_pk TEXT NOT NULL,
          url        TEXT NOT NULL,
          label      TEXT,
          source     TEXT NOT NULL CHECK (source IN ('builtin','custom')),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_faucets_url ON faucets(network_pk, url);
        CREATE INDEX idx_faucets_network ON faucets(network_pk, sort_order, created_at);
      `)
    },
  },
  {
    version: 9,
    description: 'issued ERC-20 deployments so the issue page can list them',
    up: (db) => {
      db.exec(`
        CREATE TABLE token_issues (
          id               TEXT PRIMARY KEY,
          network_pk       TEXT NOT NULL,
          account_id       TEXT NOT NULL,
          token_pk         TEXT,
          transaction_id   TEXT,
          from_address     TEXT NOT NULL,
          name             TEXT NOT NULL,
          symbol           TEXT NOT NULL,
          decimals         INTEGER NOT NULL,
          supply           TEXT NOT NULL,
          supply_minor     TEXT NOT NULL,
          contract_address TEXT,
          txid             TEXT NOT NULL,
          explorer_url     TEXT,
          status           TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
          created_at       INTEGER NOT NULL,
          updated_at       INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_token_issues_txid ON token_issues(txid);
        CREATE INDEX idx_token_issues_network ON token_issues(network_pk, created_at DESC);
      `)
    },
  },
  {
    version: 10,
    description: 'dedicated HD derived key table (address / pubkey / encrypted privkey)',
    up: (db) => {
      db.exec(`
        CREATE TABLE hd_keys (
          id                    TEXT PRIMARY KEY,
          wallet_id             TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
          wallet_type           TEXT NOT NULL CHECK (wallet_type IN ('bitcoin','web3','tron','solana')),
          account_index         INTEGER NOT NULL,
          address_index         INTEGER NOT NULL,
          root_path             TEXT NOT NULL,
          address               TEXT NOT NULL,
          public_key            TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          created_at            INTEGER NOT NULL,
          updated_at            INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_hd_keys_path
          ON hd_keys(wallet_id, wallet_type, account_index, address_index);
        CREATE INDEX idx_hd_keys_wallet
          ON hd_keys(wallet_id, wallet_type, address_index);
      `)
    },
  },
  {
    version: 11,
    description: 'HD airdrop jobs and per-recipient items for retry after test releases',
    up: (db) => {
      db.exec(`
        CREATE TABLE hd_airdrop_jobs (
          id             TEXT PRIMARY KEY,
          wallet_id      TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
          account_id     TEXT NOT NULL,
          network_pk     TEXT NOT NULL,
          token_pk       TEXT NOT NULL,
          from_address   TEXT NOT NULL,
          symbol         TEXT NOT NULL,
          decimals       INTEGER NOT NULL,
          amount_mode    TEXT NOT NULL CHECK (amount_mode IN ('fixed','range')),
          amount_text    TEXT NOT NULL,
          from_index     INTEGER NOT NULL,
          to_index       INTEGER NOT NULL,
          account_index  INTEGER NOT NULL,
          status         TEXT NOT NULL CHECK (status IN ('running','done','stopped','failed')),
          total          INTEGER NOT NULL,
          queued         INTEGER NOT NULL,
          pending        INTEGER NOT NULL,
          confirmed      INTEGER NOT NULL,
          failed         INTEGER NOT NULL,
          skipped        INTEGER NOT NULL,
          current_index  INTEGER,
          last_txid      TEXT,
          last_error     TEXT,
          estimated_ms   INTEGER NOT NULL,
          started_at     INTEGER NOT NULL,
          finished_at    INTEGER,
          created_at     INTEGER NOT NULL,
          updated_at     INTEGER NOT NULL
        );
        CREATE INDEX idx_hd_airdrop_jobs_wallet
          ON hd_airdrop_jobs(wallet_id, network_pk, created_at DESC);

        CREATE TABLE hd_airdrop_items (
          id            TEXT PRIMARY KEY,
          job_id        TEXT NOT NULL REFERENCES hd_airdrop_jobs(id) ON DELETE CASCADE,
          address_index INTEGER NOT NULL,
          to_address    TEXT NOT NULL,
          amount        TEXT NOT NULL,
          amount_minor  TEXT NOT NULL,
          status        TEXT NOT NULL CHECK (status IN ('queued','pending','confirmed','failed','skipped')),
          txid          TEXT,
          explorer_url  TEXT,
          error         TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_hd_airdrop_items_job_index
          ON hd_airdrop_items(job_id, address_index);
        CREATE INDEX idx_hd_airdrop_items_job_status
          ON hd_airdrop_items(job_id, status, address_index);
        CREATE UNIQUE INDEX idx_hd_airdrop_items_txid
          ON hd_airdrop_items(txid) WHERE txid IS NOT NULL;
      `)
    },
  },
  {
    version: 12,
    description: 'HD keys scoped by network and bitcoin address type',
    up: (db) => {
      db.exec(`
        ALTER TABLE hd_keys ADD COLUMN network_scope TEXT NOT NULL DEFAULT 'mainnet';
        ALTER TABLE hd_keys ADD COLUMN address_type TEXT;
        DROP INDEX IF EXISTS idx_hd_keys_path;
        CREATE UNIQUE INDEX idx_hd_keys_path
          ON hd_keys(
            wallet_id, wallet_type, network_scope,
            IFNULL(address_type, ''), account_index, address_index
          );
      `)
    },
  },
  {
    version: 13,
    description: 'local ABI library for encode / decode tools',
    up: (db) => {
      db.exec(`
        CREATE TABLE abi_contracts (
          id                TEXT PRIMARY KEY,
          name              TEXT NOT NULL,
          contract_address  TEXT,
          abi_json          TEXT NOT NULL,
          function_count    INTEGER NOT NULL DEFAULT 0,
          event_count       INTEGER NOT NULL DEFAULT 0,
          created_at        INTEGER NOT NULL,
          updated_at        INTEGER NOT NULL
        );
        CREATE INDEX idx_abi_contracts_name ON abi_contracts(name, updated_at);
      `)
    },
  },
  {
    version: 14,
    description: 'one transaction hash may have send and receive legs',
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_tx_unique;
        CREATE UNIQUE INDEX idx_tx_unique
          ON transactions(network_pk, txid, account_id, symbol, direction);
      `)
    },
  },
  {
    version: 15,
    description: 'dedicated EVM key for catalog API authentication',
    up: (db) => {
      db.exec(`
        CREATE TABLE catalog_auth_keys (
          id                    TEXT PRIMARY KEY,
          address               TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          created_at            INTEGER NOT NULL
        );
      `)
    },
  },
  {
    version: 16,
    description: 'optional request headers on custom RPC nodes',
    up: (db) => {
      db.exec('ALTER TABLE rpc_nodes ADD COLUMN headers TEXT')
    },
  },
  {
    version: 17,
    description: 'itemized batch transfer: job kind and recipient name',
    up: (db) => {
      db.exec(`
        ALTER TABLE hd_airdrop_jobs ADD COLUMN job_kind TEXT NOT NULL DEFAULT 'uniform';
        ALTER TABLE hd_airdrop_items ADD COLUMN to_name TEXT;
        CREATE INDEX IF NOT EXISTS idx_hd_airdrop_jobs_kind
          ON hd_airdrop_jobs(wallet_id, network_pk, job_kind, created_at DESC);
      `)
    },
  },
]

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version

export function runMigrations(db: AppDatabase): { from: number; to: number } {
  const current = Number(db.pragma('user_version', { simple: true }))
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `数据库版本 ${current} 高于当前程序支持的 ${LATEST_SCHEMA_VERSION}，请升级应用`,
    )
  }

  const pending = migrations.filter((m) => m.version > current)
  if (pending.length === 0) return { from: current, to: current }

  const apply = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.pragma(`user_version = ${migration.version}`)
    }
  })
  apply()

  return { from: current, to: LATEST_SCHEMA_VERSION }
}
