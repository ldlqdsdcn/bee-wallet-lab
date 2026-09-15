/**
 * 主进程与渲染进程共享的领域类型。
 * 命名与移动端 onewallet-app 保持一致：walletType / addressType / rootPath / network。
 */

export type WalletType = 'bitcoin' | 'web3' | 'tron' | 'solana'

export type CatalogSource = 'builtin' | 'custom'

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

/** 批量派生分层地址；默认生成 1..toIndex。不传 walletType 时按 EVM。 */
export interface HdDeriveInput {
  walletId: string
  password: string
  toIndex: number
  fromIndex?: number
  accountIndex?: number
  walletType?: WalletType
  networkScope?: NetworkScope
  addressType?: BitcoinAddressType | null
}

export type HdDeriveEvmInput = HdDeriveInput

export interface HdKeyQuery {
  walletId: string
  accountIndex?: number
  walletType?: WalletType
  networkScope?: NetworkScope
  addressType?: BitcoinAddressType | null
  fromIndex?: number
  toIndex?: number
}

export interface HdKeyRecord {
  id: string
  walletId: string
  walletType: WalletType
  networkScope: NetworkScope
  addressType: BitcoinAddressType | null
  accountIndex: number
  addressIndex: number
  path: string
  address: string
  publicKey: string
  createdAt: number
}

export interface HdDerivedEvmKey {
  id?: string
  index: number
  path: string
  address: string
  publicKey: string
  privateKey?: string
}

export interface HdDeriveEvmResult {
  walletId: string
  walletName: string
  accountIndex: number
  fromIndex: number
  toIndex: number
  saved: number
  skipped: number
  rows: HdDerivedEvmKey[]
}

export type HdAirdropAmountMode = 'fixed' | 'range'

export interface TokenBalanceRow {
  address: string
  balance: string | null
}

export interface HdAirdropInput {
  walletId: string
  accountId: string
  /** 用分层地址付款时传入；不传则用主账户 */
  hdKeyId?: string | null
  networkPk: string
  tokenPk: string
  /** EVM 收款地址，逗号分隔文本解析后的列表 */
  recipients: string[]
  amountMode: HdAirdropAmountMode
  /** 固定额度，人类可读 */
  amount?: string
  amountMin?: string
  amountMax?: string
}

export interface HdAirdropPreview {
  draftId: string
  from: string
  symbol: string
  decimals: number
  recipientCount: number
  missingCount: number
  amountMode: HdAirdropAmountMode
  amountText: string
  estimatedTotal: string
  feeText: string
  estimatedMs: number
  estimatedText: string
  warnings: string[]
}

export type HdAirdropJobStatus = 'running' | 'done' | 'stopped' | 'failed'
export type HdAirdropItemStatus = 'queued' | 'pending' | 'confirmed' | 'failed' | 'skipped'

export interface HdAirdropJob {
  id: string
  walletId: string
  accountId: string
  networkPk: string
  tokenPk: string
  fromAddress: string
  symbol: string
  decimals: number
  amountMode: HdAirdropAmountMode
  amountText: string
  fromIndex: number
  toIndex: number
  accountIndex: number
  status: HdAirdropJobStatus
  total: number
  queued: number
  pending: number
  confirmed: number
  /** pending + confirmed，已广播出去的笔数 */
  sent: number
  failed: number
  skipped: number
  currentIndex: number | null
  lastTxid: string | null
  lastError: string | null
  estimatedMs: number
  startedAt: number
  finishedAt: number | null
  createdAt: number
}

export interface HdAirdropItem {
  id: string
  jobId: string
  addressIndex: number
  toAddress: string
  amount: string
  amountMinor: string
  status: HdAirdropItemStatus
  txid: string | null
  explorerUrl: string | null
  error: string | null
  attemptCount: number
  updatedAt: number
}

export interface HdAirdropItemQuery {
  jobId: string
  status?: HdAirdropItemStatus
  page?: number
  pageSize?: number
}

export interface HdAirdropItemPage {
  jobId: string
  items: HdAirdropItem[]
  total: number
  page: number
  pageSize: number
  queued: number
  pending: number
  confirmed: number
  failed: number
  skipped: number
}

export interface HdAirdropRetryInput {
  jobId: string
  itemIds?: string[]
  /** 不传 itemIds 时：failed 只重试失败；queued 继续未发送；retryable 两者都重试 */
  scope?: 'failed' | 'queued' | 'retryable'
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
  source: CatalogSource
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
  source: CatalogSource
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

export interface NetworkUpsertInput {
  id?: string
  networkName: string
  walletType: WalletType
  networkScope: NetworkScope
  chainId: string
  chainName?: string
  rpcUrl?: string
  browser?: string
  coinId?: string
  coinEasy?: string
  icon?: string
  remark?: string
}

export interface TokenUpsertInput {
  id?: string
  networkPk: string
  name?: string
  symbol: string
  decimals?: number
  contractAddress?: string
  tokenId?: string
  tokenStandard?: string
  gasLimit?: number
  tokenIcon?: string
  isDefaultSelected?: boolean
}

/** 添加网络时按 chainId / 名称查询目录站或本地预设 */
export interface CatalogLookupQuery {
  q?: string
  chainId?: string
}

export interface CatalogLookupToken {
  name: string
  symbol: string
  decimals: number
  contractAddress: string | null
  tokenId: string | null
  tokenIcon: string | null
  isToken: boolean
}

export interface CatalogLookupResult {
  /** remote：目录站；local：内置预设 */
  source: 'remote' | 'local'
  supported: boolean
  hint: string | null
  network: NetworkUpsertInput | null
  native: CatalogLookupToken | null
  tokens: CatalogLookupToken[]
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
  /** 可读余额（已按 decimals 换算，不是 lamports/wei） */
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
  /** 行情源都失败时的说明；有值时总资产仍可能为 -- */
  priceError?: string | null
}

/* -------------------------------- 转账签名 -------------------------------- */

export type FeeLevel = 'low' | 'medium' | 'high' | 'custom'

export interface TransferDraftInput {
  accountId: string
  /** 用分层地址付款时传入；不传则用所选账户 */
  hdKeyId?: string | null
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
  /** TRC-20 能量不足时：租赁能量或燃烧 TRX */
  energyFeeMode?: TronEnergyFeeMode
}

export type TronEnergyFeeMode = 'burn' | 'rent'

export interface TransferEnergyQuote {
  priceTrx: string
  quantity: number
}

export interface TransferEnergyInfo {
  required: number
  left: number
  short: boolean
  canRent: boolean
  rentReason: string
  selected: TronEnergyFeeMode
  quote: TransferEnergyQuote | null
  /** 按链上能量单价估算的燃烧花费 */
  burnTrx: string
  /** 较贵方案多付的 TRX；无法对比时为空 */
  saveTrx: string
  cheaper: TronEnergyFeeMode | 'same' | null
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
  /** 仅 TRC-20：账户能量与租/烧选择 */
  energy?: TransferEnergyInfo
}

export interface TokenIssueInput {
  accountId: string
  networkPk: string
  name: string
  symbol: string
  decimals: number
  /** 人类可读总量，例如 1000000000 */
  supply: string
  /** Solana：简介，写入链下元数据 JSON */
  description?: string
  /** Solana：logo 图片 https 地址 */
  logoUrl?: string
  /** Solana：官网 */
  website?: string
  /** Solana：已托管的 Metaplex 元数据 JSON 地址，最长 200 */
  metadataUri?: string
}

export interface TokenIssuePreview {
  draftId: string
  from: string
  name: string
  symbol: string
  decimals: number
  supply: string
  supplyMinor: string
  feeText: string
  feeMinor: string
  warnings: string[]
  /** Solana 预览时已生成的 mint 地址；ERC-20 部署后才有 */
  contractAddress?: string | null
  logoUrl?: string | null
  website?: string | null
  metadataUri?: string | null
  /** 给用户复制去托管的元数据 JSON */
  metadataJson?: string | null
}

export interface TokenIssueResult {
  txid: string
  explorerUrl: string | null
  contractAddress: string | null
  token: TokenRecord | null
  transaction: TransactionRecord
  issue: IssuedTokenRecord
}

export interface IssuedTokenRecord {
  id: string
  networkPk: string
  accountId: string
  tokenPk: string | null
  transactionId: string | null
  fromAddress: string
  name: string
  symbol: string
  decimals: number
  supply: string
  supplyMinor: string
  contractAddress: string | null
  txid: string
  explorerUrl: string | null
  status: 'pending' | 'confirmed' | 'failed'
  createdAt: number
}

export interface BroadcastResult {
  txid: string
  explorerUrl: string | null
  reportedToBackend: boolean
  transaction: TransactionRecord
}

export type TxLabRawFormat = 'hex' | 'base64' | 'json'

/** 交易实验室：本地签名后的原始交易（尚未广播） */
export interface TxLabSigned {
  walletType: WalletType
  networkPk: string
  accountId: string
  from: string
  to: string
  amount: string
  symbol: string
  feeText: string
  raw: string
  rawFormat: TxLabRawFormat
  txid: string
  signed: boolean
  decoded: Record<string, string>
}

export interface TxLabBroadcastInput {
  networkPk: string
  raw: string
  accountId?: string
  from?: string
  to?: string
  amount?: string
  symbol?: string
  tokenPk?: string
  fee?: string
}

export interface TxLabDecodeInput {
  networkPk: string
  raw: string
}

export interface TxLabDecoded {
  walletType: WalletType
  networkPk: string
  raw: string
  rawFormat: TxLabRawFormat
  txid: string | null
  signed: boolean
  fields: Record<string, string>
  warnings: string[]
}

/* -------------------------------- ABI 工具 -------------------------------- */

export interface AbiParamInfo {
  name: string
  type: string
  indexed?: boolean
  components?: AbiParamInfo[]
}

export interface AbiFunctionInfo {
  name: string
  signature: string
  selector: string
  stateMutability: string
  inputs: AbiParamInfo[]
  outputs: AbiParamInfo[]
}

export interface AbiEventInfo {
  name: string
  signature: string
  topic0: string | null
  anonymous: boolean
  inputs: AbiParamInfo[]
}

export interface AbiParsed {
  name: string
  contractAddress: string | null
  abiJson: string
  functions: AbiFunctionInfo[]
  events: AbiEventInfo[]
  warnings: string[]
}

export interface AbiContractRecord {
  id: string
  name: string
  contractAddress: string | null
  abiJson: string
  functionCount: number
  eventCount: number
  createdAt: number
  updatedAt: number
}

export interface AbiContractUpsertInput {
  id?: string
  name: string
  contractAddress?: string | null
  abiJson: string
}

export interface AbiEncodeInput {
  abiJson: string
  signature: string
  args: string[]
}

export interface AbiEncodeResult {
  signature: string
  selector: string
  calldata: string
}

export interface AbiDecodedValue {
  name: string
  type: string
  indexed?: boolean
  value: string
}

export interface AbiDecodeCallInput {
  abiJson: string
  data: string
}

export interface AbiDecodeCallResult {
  name: string
  signature: string
  selector: string
  args: AbiDecodedValue[]
}

export interface AbiDecodeResultInput {
  abiJson: string
  signature: string
  data: string
}

export interface AbiDecodeResultOutput {
  signature: string
  values: AbiDecodedValue[]
}

export interface AbiDecodeEventInput {
  abiJson: string
  data: string
  topics: string
}

export interface AbiDecodeEventResult {
  name: string
  signature: string
  topic0: string | null
  args: AbiDecodedValue[]
}

/* -------------------------------- 合约交互 -------------------------------- */

export interface ContractReadInput {
  networkPk: string
  accountId?: string
  contractAddress: string
  abiJson: string
  signature: string
  args: string[]
}

export interface ContractReadResult {
  signature: string
  raw: string
  values: AbiDecodedValue[]
}

export interface ContractWriteInput {
  networkPk: string
  accountId: string
  contractAddress: string
  abiJson: string
  signature: string
  args: string[]
  /** 原生币金额，payable 时使用 */
  value?: string
  feeLevel?: FeeLevel
  customFeeRate?: string
  customPriorityFee?: string
  gasLimit?: string
  nonce?: number
  feeLimit?: string
}

export interface ContractWritePreview {
  draftId: string
  from: string
  contractAddress: string
  signature: string
  calldata: string
  value: string
  feeText: string
  detail: Record<string, string>
  warnings: string[]
}

export interface ContractSigned {
  walletType: WalletType
  networkPk: string
  accountId: string
  from: string
  contractAddress: string
  signature: string
  calldata: string
  value: string
  feeText: string
  raw: string
  rawFormat: TxLabRawFormat
  txid: string
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

export type AppLocale = 'zh-CN' | 'en'

export interface AppSettings {
  baseUrl: string
  autoLockMinutes: number
  currencyCode: string
  language: AppLocale
  theme: 'dark' | 'light'
  defaultWalletId: string | null
  defaultNetworkPk: string | null
  /** 总开关。关闭时即使已选择代理也直连 */
  proxyEnabled: boolean
}

export interface ProxyRecord {
  id: string
  url: string
  label: string | null
  isSelected: boolean
  lastLatencyMs: number | null
  lastError: string | null
  lastCheckedAt: number | null
  createdAt: number
}

export interface ProxyCreateInput {
  url: string
  label?: string
}

export interface ProxyUpdateInput {
  id: string
  url: string
  label?: string
}

export interface ProxyListState {
  enabled: boolean
  proxies: ProxyRecord[]
}

export interface ProxyTestResult {
  ok: boolean
  latencyMs: number | null
  message: string
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
  headers: Record<string, string> | null
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
  headersText?: string
}

export interface RpcNodeUpdateInput {
  id: string
  url?: string
  label?: string
  headersText?: string
}

/** 测试网水龙头。主网不应有记录。source 留给后续目录站同步。 */
export interface FaucetRecord {
  id: string
  networkPk: string
  url: string
  label: string | null
  source: CatalogSource
  createdAt: number
}

export interface FaucetUpsertInput {
  id?: string
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

/* -------------------------------- 开发工具 -------------------------------- */

export type DevJsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface DevJsonResult {
  pretty: string
  minified: string
  kind: DevJsonKind
  parsed: unknown
}

export type DevConvertMode = 'hex-to-utf8' | 'utf8-to-hex' | 'hex-to-base64' | 'base64-to-hex'

export interface DevConvertInput {
  mode: DevConvertMode
  value: string
}

export interface DevConvertResult {
  mode: DevConvertMode
  output: string
  bytes: number
}

export type DevHashAlgo = 'sha256' | 'keccak256' | 'sha512' | 'sha3-256' | 'ripemd160' | 'blake2b'

export type DevBytesEncoding = 'utf8' | 'hex'

export interface DevHashInput {
  value: string
  encoding: DevBytesEncoding
}

export interface DevHashItem {
  algo: DevHashAlgo
  label: string
  hex: string
}

export interface DevHashResult {
  bytes: number
  hashes: DevHashItem[]
}

/* ------------------------------- 波场能量租赁 ------------------------------- */

export type EnergyDuration = '1h' | '1d'

export interface EnergyEstimateInput {
  accountId: string
  networkPk: string
  quantity: number
  duration: EnergyDuration
}

export interface EnergyResources {
  address: string
  balanceTrx: string
  energyLimit: number
  energyUsed: number
  energyLeft: number
  bandwidthLimit: number
  bandwidthUsed: number
  bandwidthLeft: number
}

export interface EnergyQuote {
  queryNo: string
  quantity: number
  duration: EnergyDuration
  priceSun: string
  priceTrx: string
  targetAddress: string
  payAccount: string
  resources: EnergyResources
}

export interface EnergyRentInput {
  accountId: string
  networkPk: string
  queryNo: string
  quantity: number
  duration: EnergyDuration
  priceSun: string
  targetAddress: string
}

export interface EnergyRentResult {
  orderNo: string | null
  payTxHash: string
  explorerUrl: string | null
  status: number
  description: string
}

export interface EnergyConfirmInput {
  accountId: string
  networkPk: string
  queryNo: string
  targetAddress: string
  payTxHash: string
}

export interface EnergyOrderStatus {
  orderNo: string
  status: number
  description: string
}

/* -------------------------------- 同网络兑换 -------------------------------- */

export type SwapKind = 'evm' | 'tron'

export interface SwapQuoteInput {
  accountId: string
  networkPk: string
  sellTokenPk: string
  buyTokenPk: string
  sellAmount: string
  slippageBps?: number
}

export interface SwapEnergyInfo {
  needed: boolean
  quantity: number
  duration: EnergyDuration
  burnTrx: string
  rentTrx: string | null
  saveTrx: string
  cheaper: TronEnergyFeeMode | 'same' | null
}

export interface SwapQuote {
  kind: SwapKind
  chainId: number
  sellSymbol: string
  buySymbol: string
  sellAmount: string
  buyAmount: string
  minBuyAmount: string
  sellAmountMinor: string
  buyAmountMinor: string
  feeText: string
  allowanceNeeded: boolean
  allowanceTarget: string | null
  energy: SwapEnergyInfo | null
  warnings: string[]
}

export interface SwapSubmitInput extends SwapQuoteInput {
  energyFeeMode?: TronEnergyFeeMode
}

export interface SwapSubmitResult {
  quoteId: string
  txid: string
  approveTxid: string | null
  explorerUrl: string | null
}

export interface SwapHistoryItem {
  id: string
  chainId: number
  status: string
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  txHash: string | null
  created: string
}

/* -------------------------------- 跨链桥 -------------------------------- */

export type BridgeSortBy = 'price' | 'speed'

export interface BridgeQuoteInput {
  originAccountId: string
  originNetworkPk: string
  destNetworkPk: string
  destAccountId?: string
  destAddress?: string
  sellTokenPk: string
  buyTokenPk: string
  sellAmount: string
  slippageBps?: number
  sortQuotesBy?: BridgeSortBy
}

export interface BridgeQuoteOption {
  index: number
  sellAmount: string
  buyAmount: string
  minBuyAmount: string
  estimatedTimeSeconds: number | null
  feeText: string
  networkFeeText: string | null
  allowanceNeeded: boolean
  allowanceTarget: string | null
}

export interface BridgeQuote {
  originChainId: number
  destinationChainId: number
  originAddress: string
  destinationAddress: string
  sellSymbol: string
  buySymbol: string
  sellAmount: string
  options: BridgeQuoteOption[]
  energy: SwapEnergyInfo | null
  networkFeeText: string | null
  warnings: string[]
  provider: string | null
  liquidityAvailable: boolean
}

export interface BridgeSubmitInput extends BridgeQuoteInput {
  quoteIndex: number
  energyFeeMode?: TronEnergyFeeMode
}

export interface BridgeSubmitResult {
  quoteId: string
  txid: string
  approveTxid: string | null
  explorerUrl: string | null
  destTxHash: string | null
  status: string
  feeText: string | null
}

export interface BridgeStatus {
  quoteId: string
  status: string
  txHash: string | null
  destTxHash: string | null
  bridgeStatus: string | null
  estimatedTimeSeconds: number | null
  provider: string | null
}

export interface BridgeHistoryItem {
  id: string
  originChainId: number
  destinationChainId: number
  originAddress: string
  destinationAddress: string
  status: string
  sellToken: string
  buyToken: string
  sellAmount: string
  buyAmount: string
  txHash: string | null
  destTxHash: string | null
  created: string
}

/** 目录站 /api/dappCategory、/api/dapp 拉下来的三方连接 */
export const DAPP_HOT_CATEGORY_ID = 'hot'

export interface DappCategoryRecord {
  id: string
  name: string
  icon: string | null
  sort: number
  /** 本地拼的「热门」，不是目录分类 id */
  virtual: boolean
}

export interface DappRecord {
  id: string
  categoryId: string
  name: string
  url: string
  icon: string | null
  remark: string | null
  isHot: boolean
  isTop: boolean
  sort: number
}

export interface DappCatalog {
  categories: DappCategoryRecord[]
  dapps: DappRecord[]
}

export interface WalletConnectStatus {
  ready: boolean
  projectIdSet: boolean
  error: string | null
}

export interface WalletConnectPairing {
  active: boolean
  error: string | null
  deadlineAt: number | null
}

export interface WalletConnectSession {
  topic: string
  name: string
  url: string
  icon: string
  chains: string[]
  expiry: number
}

export type WalletConnectPendingKind = 'session' | 'auth' | 'sign' | 'send' | 'switch'

export interface WalletConnectPending {
  id: string
  kind: WalletConnectPendingKind
  origin: string
  name: string
  method: string
  detail: string
  verification?: 'VALID' | 'UNKNOWN' | 'INVALID' | 'SCAM'
}
