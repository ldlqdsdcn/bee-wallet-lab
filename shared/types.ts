/**
 * 主进程与渲染进程共享的领域类型。
 * 命名与移动端 onewallet-app 保持一致：walletType / addressType / rootPath / network。
 */

export type WalletType = 'bitcoin' | 'web3' | 'tron' | 'solana'

export type BitcoinAddressType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr'

export type NetworkScope = 'mainnet' | 'testnet'

export type AccountSource = 'hd' | 'imported'

export type MnemonicLength = 12 | 15 | 18 | 21 | 24

/** 保险库（主密码）状态，渲染进程只能看到这些非敏感字段 */
export interface VaultStatus {
  /** 是否已完成主密码初始化 */
  initialized: boolean
  unlocked: boolean
  autoLockMinutes: number
  /** 连续失败次数 */
  failedAttempts: number
  /** 处于惩罚延迟时的解锁可用时间戳（毫秒） */
  lockoutUntil: number | null
}

export interface WalletSummary {
  id: string
  name: string
  mnemonicLength: MnemonicLength
  hasPassphrase: boolean
  isDefault: boolean
  /** 是否用于后端 JWT 鉴权 */
  isAuthWallet: boolean
  createdAt: number
  accountCount: number
}

/** 切换钱包弹窗的一页数据；总余额只读余额缓存，不打节点。 */
export interface WalletPickerItem {
  id: string
  name: string
  isDefault: boolean
  cachedTotal: string | null
}

export interface WalletPickerQuery {
  name?: string
  page?: number
  pageSize?: number
}

export interface WalletPickerPage {
  items: WalletPickerItem[]
  total: number
  page: number
  pageSize: number
  currencyCode: string
}

export interface AccountRecord {
  id: string
  walletId: string | null
  walletType: WalletType
  networkScope: NetworkScope
  addressType: BitcoinAddressType | null
  rootPath: string | null
  accountIndex: number
  addressIndex: number
  address: string
  publicKey: string
  label: string | null
  source: AccountSource
  createdAt: number
}

/** 单条派生结果（不含私钥） */
export interface DerivedAddress {
  walletType: WalletType
  networkScope: NetworkScope
  addressType: BitcoinAddressType | null
  rootPath: string
  accountIndex: number
  addressIndex: number
  address: string
  publicKey: string
}

export interface CreateWalletInput {
  name: string
  mnemonicLength: 12 | 24
  passphrase?: string
}

export interface ImportWalletInput {
  name: string
  mnemonic: string
  passphrase?: string
}

export interface ImportPrivateKeyInput {
  walletType: WalletType
  networkScope: NetworkScope
  addressType?: BitcoinAddressType
  privateKey: string
  label?: string
}

export interface DeriveAccountInput {
  walletId: string
  walletType: WalletType
  networkScope: NetworkScope
  addressType?: BitcoinAddressType
  accountIndex?: number
  addressIndex?: number
  /** 高级模式：直接指定完整路径，忽略 accountIndex / addressIndex */
  customPath?: string
  label?: string
}

/** 助记词生成预览（尚未落库） */
export interface MnemonicDraft {
  draftId: string
  words: string[]
  /** 抄写校验要求填写的词序号（从 1 开始） */
  challengeIndexes: number[]
}

/* ------------------------------ 后端目录数据 ------------------------------ */

export interface NetworkRecord {
  /** 后端主键 */
  id: string
  networkId: string
  networkName: string
  chainId: string
  chainName: string
  chainType: string | null
  /** 后端 type 字段：web3 / tron / bitcoin */
  walletType: WalletType
  coinId: string | null
  coinEasy: string | null
  rpcUrl: string | null
  browser: string | null
  icon: string | null
  webAddress: string | null
  supportGasTime: string | null
  remark: string | null
  /** 由 chainId / chainName 推断 */
  networkScope: NetworkScope
  syncedAt: number
}

export interface TokenRecord {
  id: string
  tokenId: string | null
  name: string | null
  symbol: string
  decimals: number
  /** "0" 或空表示原生币 */
  contractAddress: string | null
  tokenStandard: string | null
  isToken: boolean
  gasLimit: number | null
  networkPk: string
  tokenIcon: string | null
  blockchainExplorer: string | null
  isDefaultSelected: boolean
  syncedAt: number
}

export interface CurrencyRecord {
  id: string
  code: string
  name: string | null
  symbol: string | null
  syncedAt: number
}

export interface CatalogSyncMeta {
  name: string
  lastSyncAt: number | null
  itemCount: number
  lastError: string | null
}

export interface CatalogSyncResult {
  networks: number
  tokens: number
  currencies: number
  offline: boolean
  error: string | null
  syncedAt: number
}

/* -------------------------------- 资产余额 -------------------------------- */

/** 首页资产条目；BTC 原生币会按地址格式展开为四条 */
export interface AssetEntry {
  /** 本地唯一 id：tokenPk 或 `${tokenPk}:${networkScope}:${addressType}` */
  key: string
  tokenPk: string
  networkPk: string
  symbol: string
  name: string
  decimals: number
  iconUrl: string | null
  isToken: boolean
  contractAddress: string | null
  addressType: BitcoinAddressType | null
  address: string | null
  accountId: string | null
  /** 最小单位余额 */
  balance: string
  /** 未确认余额（仅 BTC） */
  unconfirmed: string | null
  /** 法币折算，取不到为 null */
  currencyBalance: string | null
  updatedAt: number | null
  stale: boolean
  error: string | null
}

export interface PortfolioSnapshot {
  networkPk: string
  currencyCode: string
  totalCurrency: string | null
  entries: AssetEntry[]
  /** 数据来自缓存且后端不可用 */
  offline: boolean
}

/* -------------------------------- 转账签名 -------------------------------- */

export type FeeLevel = 'low' | 'medium' | 'high' | 'custom'

export interface TransferDraftInput {
  accountId: string
  networkPk: string
  tokenPk: string
  to: string
  /** 用户输入的可读金额 */
  amount: string
  sendMax?: boolean
  feeLevel: FeeLevel
  /** BTC: sat/vB；EVM: gwei maxFeePerGas */
  customFeeRate?: string
  customPriorityFee?: string
  gasLimit?: string
  nonce?: number
  feeLimit?: string
}

export interface TransferPreview {
  draftId: string
  from: string
  to: string
  amount: string
  amountMinor: string
  symbol: string
  decimals: number
  feeMinor: string
  feeText: string
  totalMinor: string
  /** 开发者视角：构建出的未签名交易描述 */
  detail: Record<string, string>
  warnings: string[]
}

export interface BroadcastResult {
  txid: string
  explorerUrl: string | null
  reportedToBackend: boolean
}

export interface TransactionRecord {
  id: string
  networkPk: string
  accountId: string
  txid: string
  direction: 'send' | 'receive'
  fromAddress: string
  toAddress: string
  tokenPk: string | null
  symbol: string
  amount: string
  fee: string | null
  status: 'pending' | 'confirmed' | 'failed'
  blockHeight: number | null
  rawHex: string | null
  submittedToBackend: boolean
  createdAt: number
  explorerUrl: string | null
}

/* -------------------------------- 消息签名 -------------------------------- */

export interface SignMessageInput {
  accountId: string
  message: string
}

export interface SignMessageResult {
  address: string
  walletType: WalletType
  addressType: BitcoinAddressType | null
  /** 待签摘要，便于开发者核对 */
  digest: string
  scheme: string
  signature: string
}

export interface VerifyMessageInput {
  walletType: WalletType
  address: string
  message: string
  signature: string
}

export interface VerifyMessageResult {
  valid: boolean
  recoveredAddress: string | null
}

/* --------------------------------- 地址簿 --------------------------------- */

/** 地址簿条目：只保存收款方公开信息，不含任何密钥 */
export interface AddressBookEntry {
  id: string
  /** 备注名称 */
  label: string
  walletType: WalletType
  networkScope: NetworkScope
  /** 绑定的具体网络（catalog_networks.id）；为 null 表示适用于该链全部网络 */
  networkPk: string | null
  /** 网络展示名，来自目录快照，纯冗余字段便于列表直出 */
  networkName: string | null
  address: string
  memo: string | null
  /** 最近一次被用于转账的时间，用于列表排序 */
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface AddressBookUpsertInput {
  /** 传 id 为更新，不传为新增 */
  id?: string
  label: string
  walletType: WalletType
  networkScope: NetworkScope
  networkPk?: string | null
  networkName?: string | null
  address: string
  memo?: string | null
}

export interface AddressBookQuery {
  walletType?: WalletType
  networkScope?: NetworkScope
  networkPk?: string | null
  /** 按名称或地址模糊匹配 */
  keyword?: string
}

/* ---------------------------------- 设置 ---------------------------------- */

export interface AppSettings {
  baseUrl: string
  autoLockMinutes: number
  currencyCode: string
  language: string
  theme: 'dark' | 'light'
  defaultWalletId: string | null
  defaultNetworkPk: string | null
}

export interface BackendStatus {
  baseUrl: string
  reachable: boolean
  authAddress: string | null
  authenticated: boolean
  tokenExpiresAt: number | null
  message: string | null
}

export type RpcNodeSource = 'builtin' | 'custom'

export interface RpcNodeRecord {
  id: string
  networkPk: string
  url: string
  label: string | null
  source: RpcNodeSource
  isSelected: boolean
  lastLatencyMs: number | null
  lastError: string | null
  lastCheckedAt: number | null
  createdAt: number
}

export interface RpcNodeCreateInput {
  networkPk: string
  url: string
  label?: string
}

export interface RpcPingResult {
  id: string
  ok: boolean
  latencyMs: number | null
  error: string | null
}
