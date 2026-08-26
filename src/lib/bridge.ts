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
  CatalogSyncResult,
  CreateWalletInput,
  CurrencyRecord,
  DeriveAccountInput,
  DerivedAddress,
  ImportPrivateKeyInput,
  ImportWalletInput,
  MnemonicDraft,
  NetworkRecord,
  PortfolioSnapshot,
  SignMessageInput,
  SignMessageResult,
  TokenRecord,
  TransactionRecord,
  TransferDraftInput,
  TransferPreview,
  VaultStatus,
  VerifyMessageInput,
  VerifyMessageResult,
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
  remove: (walletId: string) => call<true>(IPC.walletRemove, { walletId }),
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
}

export const catalogApi = {
  networks: () => call<NetworkRecord[]>(IPC.catalogNetworks),
  tokens: (networkPk?: string) => call<TokenRecord[]>(IPC.catalogTokens, { networkPk }),
  currencies: () => call<CurrencyRecord[]>(IPC.catalogCurrencies),
  sync: (force = false) => call<CatalogSyncResult>(IPC.catalogSync, { force }),
}

export const portfolioApi = {
  snapshot: (networkPk?: string) => call<PortfolioSnapshot>(IPC.portfolioSnapshot, { networkPk }),
  refresh: (networkPk?: string) => call<PortfolioSnapshot>(IPC.portfolioRefresh, { networkPk }),
}

export const transferApi = {
  preview: (input: TransferDraftInput) => call<TransferPreview>(IPC.transferPreview, input),
  submit: (draftId: string) => call<BroadcastResult>(IPC.transferSubmit, { draftId }),
  receiveInfo: (accountId: string) => call<AccountRecord>(IPC.transferReceiveInfo, { accountId }),
  transactions: (accountId?: string) => call<TransactionRecord[]>(IPC.transactionList, { accountId }),
}

export const signApi = {
  sign: (input: SignMessageInput) => call<SignMessageResult>(IPC.signMessage, input),
  verify: (input: VerifyMessageInput) => call<VerifyMessageResult>(IPC.verifyMessage, input),
}
