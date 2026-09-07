import { IPC, IPC_EVENT } from '../../../shared/ipc'
import type {
  AccountRecord,
  CreateWalletInput,
  DeriveAccountInput,
  DerivedAddress,
  HdDerivedEvmKey,
  HdDeriveEvmInput,
  HdDeriveEvmResult,
  HdKeyRecord,
  ImportPrivateKeyInput,
  ImportWalletInput,
  MnemonicDraft,
  WalletPickerPage,
  WalletPickerQuery,
  WalletSummary,
} from '../../../shared/types'
import { handle, broadcast, invalidArg, requireObject, requireString } from './registry'
import * as wallets from '../wallets/service'

export function registerWalletIpc(): void {
  const changed = <T>(value: T): T => {
    broadcast(IPC_EVENT.walletsChanged)
    return value
  }

  handle<void, WalletSummary[]>(IPC.walletList, () => wallets.listWallets())

  handle<WalletPickerQuery | undefined, WalletPickerPage>(IPC.walletListPage, (arg) =>
    wallets.listWalletPicker(arg ?? {}),
  )

  handle<void, WalletSummary | null>(IPC.walletCurrent, () => wallets.getCurrentWallet())

  handle<CreateWalletInput, MnemonicDraft>(IPC.walletCreateDraft, (arg) => {
    const input = requireObject<CreateWalletInput>(arg)
    return wallets.createWalletDraft(input)
  })

  handle<{ draftId: string; answers: Record<string, string> }, WalletSummary>(
    IPC.walletConfirmDraft,
    (arg) => {
      const input = requireObject<{ draftId: string; answers: Record<string, string> }>(arg)
      return changed(
        wallets.confirmWalletDraft({
          draftId: requireString(input.draftId, 'draftId'),
          answers: input.answers ?? {},
        }),
      )
    },
  )

  handle<ImportWalletInput, WalletSummary>(IPC.walletImportMnemonic, (arg) =>
    changed(wallets.importMnemonic(requireObject<ImportWalletInput>(arg))),
  )

  handle<{ mnemonic: string }, { valid: boolean; wordCount: number | null }>(
    IPC.walletValidateMnemonic,
    (arg) => wallets.validateMnemonicPhrase(requireString(arg?.mnemonic, 'mnemonic')),
  )

  handle<{ walletId: string; password: string }, { mnemonic: string; passphrase: string | null }>(
    IPC.walletExportMnemonic,
    (arg) =>
      wallets.exportMnemonic(requireString(arg?.walletId, 'walletId'), requireString(arg?.password, 'password')),
  )

  handle<{ walletId: string; name: string }, WalletSummary>(IPC.walletRename, (arg) =>
    changed(wallets.renameWallet(requireString(arg?.walletId, 'walletId'), requireString(arg?.name, 'name'))),
  )

  handle<{ walletId: string }, WalletSummary>(IPC.walletSetDefault, (arg) =>
    changed(wallets.markDefaultWallet(requireString(arg?.walletId, 'walletId'))),
  )

  handle<{ walletId: string }, WalletSummary>(IPC.walletSetAuthWallet, (arg) =>
    wallets.markAuthWallet(requireString(arg?.walletId, 'walletId')),
  )

  handle<{ walletId: string; password: string }, true>(IPC.walletRemove, (arg) =>
    changed(
      wallets.removeWallet(
        requireString(arg?.walletId, 'walletId'),
        requireString(arg?.password, 'password'),
      ),
    ),
  )

  handle<{ walletId?: string }, AccountRecord[]>(IPC.accountList, (arg) =>
    wallets.listAccounts(arg?.walletId),
  )

  handle<DeriveAccountInput, AccountRecord>(IPC.accountDerive, (arg) => {
    const input = requireObject<DeriveAccountInput>(arg)
    if (!input.walletId) throw invalidArg('walletId 不能为空')
    return changed(wallets.deriveAccount(input))
  })

  handle<ImportPrivateKeyInput, AccountRecord>(IPC.accountImportPrivateKey, (arg) =>
    changed(wallets.importPrivateKey(requireObject<ImportPrivateKeyInput>(arg))),
  )

  handle<{ accountId: string; password: string }, string>(IPC.accountRevealPrivateKey, (arg) =>
    wallets.revealPrivateKey(requireString(arg?.accountId, 'accountId'), requireString(arg?.password, 'password')),
  )

  handle<{ accountId: string; label: string }, AccountRecord>(IPC.accountRename, (arg) =>
    wallets.renameAccount(requireString(arg?.accountId, 'accountId'), requireString(arg?.label, 'label')),
  )

  handle<{ accountId: string }, true>(IPC.accountRemove, (arg) =>
    changed(wallets.removeAccount(requireString(arg?.accountId, 'accountId'))),
  )

  handle<DeriveAccountInput, DerivedAddress>(IPC.accountPreviewDerivation, (arg) =>
    wallets.previewDerivation(requireObject<DeriveAccountInput>(arg)),
  )

  handle<HdDeriveEvmInput, HdDeriveEvmResult>(IPC.accountHdDeriveEvm, (arg) => {
    const input = requireObject<HdDeriveEvmInput>(arg)
    if (!input.walletId) throw invalidArg('walletId 不能为空')
    return wallets.batchDeriveEvm(input)
  })

  handle<{ walletId: string; accountIndex?: number }, HdKeyRecord[]>(IPC.accountHdKeyList, (arg) =>
    wallets.listHdKeyTable(requireString(arg?.walletId, 'walletId'), arg?.accountIndex),
  )

  handle<{ walletId: string; password: string; accountIndex?: number }, HdDerivedEvmKey[]>(
    IPC.accountHdKeyUnlock,
    (arg) =>
      wallets.unlockHdKeyTable(
        requireString(arg?.walletId, 'walletId'),
        requireString(arg?.password, 'password'),
        arg?.accountIndex,
      ),
  )

  handle<{ walletId: string; password: string; accountIndex?: number }, number>(
    IPC.accountHdKeyClear,
    (arg) =>
      wallets.clearHdKeyTable(
        requireString(arg?.walletId, 'walletId'),
        requireString(arg?.password, 'password'),
        arg?.accountIndex,
      ),
  )
}
