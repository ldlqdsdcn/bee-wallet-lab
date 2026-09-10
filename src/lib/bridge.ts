/**
 * 渲染进程调用主进程的统一入口。
 *
 * 把 IpcResult 解包成正常返回值或抛错，业务代码不必层层判断 ok。
 */
import { IPC, type IpcChannel, type IpcEventName } from '@shared/ipc'
import type {
  AccountRecord,
  AddressBookEntry,
  AddressBookQuery,
  AddressBookUpsertInput,
  AppSettings,
  BackendStatus,
  BroadcastResult,
  CatalogLookupQuery,
  CatalogLookupResult,
  CatalogSyncResult,
  CreateWalletInput,
  CurrencyRecord,
  DeriveAccountInput,
  DerivedAddress,
  ImportPrivateKeyInput,
  HdDerivedEvmKey,
  HdDeriveEvmInput,
  HdDeriveEvmResult,
  HdAirdropInput,
  HdAirdropItemPage,
  HdAirdropItemQuery,
  HdAirdropJob,
  HdAirdropPreview,
  HdAirdropRetryInput,
  HdKeyQuery,
  HdKeyRecord,
  ImportWalletInput,
  MnemonicDraft,
  NetworkRecord,
  NetworkUpsertInput,
  PortfolioSnapshot,
  ProxyCreateInput,
  ProxyListState,
  ProxyTestResult,
  ProxyUpdateInput,
  SignMessageInput,
  SignMessageResult,
  IssuedTokenRecord,
  TokenIssueInput,
  TokenIssuePreview,
  TokenIssueResult,
  TokenRecord,
  TokenUpsertInput,
  TransactionRecord,
  TransferDraftInput,
  TransferPreview,
  TxLabBroadcastInput,
  TxLabDecoded,
  TxLabDecodeInput,
  TxLabSigned,
  VaultStatus,
  VerifyMessageInput,
  VerifyMessageResult,
  FaucetRecord,
  FaucetUpsertInput,
  RpcNodeCreateInput,
  RpcNodeRecord,
  RpcPingResult,
  WalletPickerPage,
  WalletPickerQuery,
  WalletSummary,
} from '@shared/types'

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeError'
  }
}

function bridge() {
  if (typeof window === 'undefined' || !window.beeWallet) {
    throw new BridgeError('NO_BRIDGE', '未检测到主进程桥接，请在 Electron 中运行')
  }
  return window.beeWallet
}

export async function call<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  const result = await bridge().invoke<T>(channel, payload)
  if (!result.ok) {
    throw new BridgeError(result.error?.code ?? 'INTERNAL', result.error?.message ?? '调用失败')
  }
  return result.data as T
}

export function on(event: IpcEventName, listener: (payload: unknown) => void): () => void {
  return bridge().subscribe(event, listener)
}

/* ------------------------------ 分组 API ------------------------------ */

export const vaultApi = {
  status: () => call<VaultStatus>(IPC.vaultStatus),
  initialize: (password: string) => call<VaultStatus>(IPC.vaultInitialize, { password }),
  unlock: (password: string) => call<VaultStatus>(IPC.vaultUnlock, { password }),
  lock: () => call<VaultStatus>(IPC.vaultLock),
  changePassword: (oldPassword: string, newPassword: string) =>
    call<VaultStatus>(IPC.vaultChangePassword, { oldPassword, newPassword }),
  touch: () => call<VaultStatus>(IPC.vaultTouch),
}

export const settingsApi = {
  get: () => call<AppSettings>(IPC.settingsGet),
  update: (patch: Partial<AppSettings>) => call<AppSettings>(IPC.settingsUpdate, patch),
}

export const addressBookApi = {
  list: (query: AddressBookQuery = {}) => call<AddressBookEntry[]>(IPC.addressBookList, query),
  upsert: (input: AddressBookUpsertInput) => call<AddressBookEntry>(IPC.addressBookUpsert, input),
  remove: (id: string) => call<true>(IPC.addressBookRemove, { id }),
  /** 转账重用该地址后上报，用于常用联系人排序 */
  touch: (id: string) => call<true>(IPC.addressBookTouch, { id }),
}

export const backendApi = {
  status: () => call<BackendStatus>(IPC.backendStatus),
  authenticate: () => call<BackendStatus>(IPC.backendAuthenticate),
  ping: () => call<boolean>(IPC.backendPing),
}

export const walletApi = {
  list: () => call<WalletSummary[]>(IPC.walletList),
  listPage: (query: WalletPickerQuery = {}) => call<WalletPickerPage>(IPC.walletListPage, query),
  current: () => call<WalletSummary | null>(IPC.walletCurrent),
  createDraft: (input: CreateWalletInput) => call<MnemonicDraft>(IPC.walletCreateDraft, input),
  confirmDraft: (draftId: string, answers: Record<string, string>) =>
    call<WalletSummary>(IPC.walletConfirmDraft, { draftId, answers }),
  importMnemonic: (input: ImportWalletInput) => call<WalletSummary>(IPC.walletImportMnemonic, input),
  validateMnemonic: (mnemonic: string) =>
    call<{ valid: boolean; wordCount: number | null }>(IPC.walletValidateMnemonic, { mnemonic }),
  exportMnemonic: (walletId: string, password: string) =>
    call<{ mnemonic: string; passphrase: string | null }>(IPC.walletExportMnemonic, { walletId, password }),
  rename: (walletId: string, name: string) => call<WalletSummary>(IPC.walletRename, { walletId, name }),
  setDefault: (walletId: string) => call<WalletSummary>(IPC.walletSetDefault, { walletId }),
  setAuthWallet: (walletId: string) => call<WalletSummary>(IPC.walletSetAuthWallet, { walletId }),
  remove: (walletId: string, password: string) =>
    call<true>(IPC.walletRemove, { walletId, password }),
}

export const accountApi = {
  list: (walletId?: string) => call<AccountRecord[]>(IPC.accountList, { walletId }),
  derive: (input: DeriveAccountInput) => call<AccountRecord>(IPC.accountDerive, input),
  importPrivateKey: (input: ImportPrivateKeyInput) =>
    call<AccountRecord>(IPC.accountImportPrivateKey, input),
  revealPrivateKey: (accountId: string, password: string) =>
    call<string>(IPC.accountRevealPrivateKey, { accountId, password }),
  rename: (accountId: string, label: string) => call<AccountRecord>(IPC.accountRename, { accountId, label }),
  remove: (accountId: string) => call<true>(IPC.accountRemove, { accountId }),
  preview: (input: DeriveAccountInput) => call<DerivedAddress>(IPC.accountPreviewDerivation, input),
  hdDeriveEvm: (input: HdDeriveEvmInput) => call<HdDeriveEvmResult>(IPC.accountHdDeriveEvm, input),
  hdKeyList: (query: HdKeyQuery) => call<HdKeyRecord[]>(IPC.accountHdKeyList, query),
  hdKeyUnlock: (query: HdKeyQuery & { password: string }) =>
    call<HdDerivedEvmKey[]>(IPC.accountHdKeyUnlock, query),
  hdKeyReveal: (walletId: string, keyId: string, password: string) =>
    call<HdDerivedEvmKey>(IPC.accountHdKeyReveal, { walletId, keyId, password }),
  hdKeyClear: (query: HdKeyQuery & { password: string }) =>
    call<number>(IPC.accountHdKeyClear, query),
}

export const catalogApi = {
  networks: () => call<NetworkRecord[]>(IPC.catalogNetworks),
  tokens: (networkPk?: string) => call<TokenRecord[]>(IPC.catalogTokens, { networkPk }),
  currencies: () => call<CurrencyRecord[]>(IPC.catalogCurrencies),
  sync: (force = false) => call<CatalogSyncResult>(IPC.catalogSync, { force }),
  lookup: (query: CatalogLookupQuery) => call<CatalogLookupResult>(IPC.catalogLookup, query),
  upsertNetwork: (input: NetworkUpsertInput) => call<NetworkRecord>(IPC.catalogNetworkUpsert, input),
  removeNetwork: (id: string) => call<true>(IPC.catalogNetworkRemove, { id }),
  upsertToken: (input: TokenUpsertInput) => call<TokenRecord>(IPC.catalogTokenUpsert, input),
  removeToken: (id: string) => call<true>(IPC.catalogTokenRemove, { id }),
}

export const portfolioApi = {
  snapshot: (networkPk?: string) => call<PortfolioSnapshot>(IPC.portfolioSnapshot, { networkPk }),
  refresh: (networkPk?: string) => call<PortfolioSnapshot>(IPC.portfolioRefresh, { networkPk }),
}

export const tokenApi = {
  preview: (input: TokenIssueInput) => call<TokenIssuePreview>(IPC.tokenIssuePreview, input),
  submit: (draftId: string) => call<TokenIssueResult>(IPC.tokenIssueSubmit, { draftId }),
  list: (networkPk?: string) => call<IssuedTokenRecord[]>(IPC.tokenIssueList, { networkPk }),
}

export const hdAirdropApi = {
  preview: (input: HdAirdropInput) => call<HdAirdropPreview>(IPC.hdAirdropPreview, input),
  start: (draftId: string) => call<HdAirdropJob>(IPC.hdAirdropStart, { draftId }),
  stop: (jobId?: string) => call<HdAirdropJob | null>(IPC.hdAirdropStop, { jobId }),
  status: (jobId?: string) => call<HdAirdropJob | null>(IPC.hdAirdropStatus, { jobId }),
  jobs: (walletId?: string, networkPk?: string) =>
    call<HdAirdropJob[]>(IPC.hdAirdropJobs, { walletId, networkPk }),
  items: (query: HdAirdropItemQuery) => call<HdAirdropItemPage>(IPC.hdAirdropItems, query),
  retry: (input: HdAirdropRetryInput) => call<HdAirdropJob>(IPC.hdAirdropRetry, input),
}

export const transferApi = {
  preview: (input: TransferDraftInput) => call<TransferPreview>(IPC.transferPreview, input),
  submit: (draftId: string) => call<BroadcastResult>(IPC.transferSubmit, { draftId }),
  receiveInfo: (accountId: string) => call<AccountRecord>(IPC.transferReceiveInfo, { accountId }),
  transactions: (query?: { networkPk?: string; accountId?: string }) =>
    call<TransactionRecord[]>(IPC.transactionList, query ?? {}),
  syncTransactions: (networkPk: string) => call<TransactionRecord[]>(IPC.transactionSync, { networkPk }),
}

export const txLabApi = {
  sign: (draftId: string) => call<TxLabSigned>(IPC.txLabSign, { draftId }),
  decode: (input: TxLabDecodeInput) => call<TxLabDecoded>(IPC.txLabDecode, input),
  broadcast: (input: TxLabBroadcastInput) => call<BroadcastResult>(IPC.txLabBroadcast, input),
}

export const signApi = {
  sign: (input: SignMessageInput) => call<SignMessageResult>(IPC.signMessage, input),
  verify: (input: VerifyMessageInput) => call<VerifyMessageResult>(IPC.verifyMessage, input),
}

export const proxyApi = {
  list: () => call<ProxyListState>(IPC.proxyList),
  add: (input: ProxyCreateInput) => call<ProxyListState>(IPC.proxyAdd, input),
  update: (input: ProxyUpdateInput) => call<ProxyListState>(IPC.proxyUpdate, input),
  remove: (id: string) => call<ProxyListState>(IPC.proxyRemove, { id }),
  select: (id: string) => call<ProxyListState>(IPC.proxySelect, { id }),
  ping: (id: string) => call<ProxyTestResult>(IPC.proxyPing, { id }),
  pingAll: () => call<ProxyTestResult[]>(IPC.proxyPingAll),
  setEnabled: (enabled: boolean) => call<ProxyListState>(IPC.proxySetEnabled, { enabled }),
}

export const faucetApi = {
  list: (networkPk: string) => call<FaucetRecord[]>(IPC.faucetList, { networkPk }),
  upsert: (input: FaucetUpsertInput) => call<FaucetRecord>(IPC.faucetUpsert, input),
  remove: (id: string) => call<true>(IPC.faucetRemove, { id }),
  restore: (networkPk: string) => call<FaucetRecord[]>(IPC.faucetRestore, { networkPk }),
}

export const rpcApi = {
  list: (networkPk: string) => call<RpcNodeRecord[]>(IPC.rpcList, { networkPk }),
  add: (input: RpcNodeCreateInput) => call<RpcNodeRecord>(IPC.rpcAdd, input),
  remove: (id: string) => call<true>(IPC.rpcRemove, { id }),
  select: (id: string) => call<RpcNodeRecord>(IPC.rpcSelect, { id }),
  useAuto: (networkPk: string) => call<RpcNodeRecord[]>(IPC.rpcSelect, { networkPk }),
  ping: (id: string) => call<RpcPingResult>(IPC.rpcPing, { id }),
  pingAll: (networkPk: string) => call<RpcPingResult[]>(IPC.rpcPingAll, { networkPk }),
  restore: (networkPk: string) => call<RpcNodeRecord[]>(IPC.rpcRestore, { networkPk }),
}
