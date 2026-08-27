/**
 * IPC 汇总注册入口。
 */
import { IPC, IPC_CHANNELS, IPC_EVENT, type IpcChannel } from '../../../shared/ipc'
import type {
  AddressBookEntry,
  AddressBookQuery,
  AddressBookUpsertInput,
  AppSettings,
  BackendStatus,
  VaultStatus,
  WalletType,
} from '../../../shared/types'
import * as vault from '../security/vault'
import { loadSettings, saveSettings } from '../db/repos/metaRepo'
import {
  listAddressBook,
  removeAddressBookEntry,
  touchAddressBookEntry,
  upsertAddressBookEntry,
} from '../db/repos/addressBookRepo'
import { reencryptAuthTokens } from '../db/repos/authTokenRepo'
import { authenticate, getBackendStatus, ping, resetBackend } from '../backend/client'
import { hydrateAuthToken } from '../backend/auth'
import { reencryptWalletSecrets, initWalletAuth } from '../wallets/service'
import { syncCatalog } from '../catalog/sync'
import { isBitcoinAddress } from '../derive/bitcoin'
import { isChecksumValid, isEvmAddress } from '../derive/evm'
import { isTronAddress } from '../derive/tron'
import { isSolanaAddress } from '../derive/solana'
import { broadcast, handle, handleNotImplemented, invalidArg, listRegistered, requireString } from './registry'
import { registerWalletIpc } from './wallets'
import { registerCatalogIpc } from './catalog'
import { registerPortfolioIpc } from './portfolio'
import { registerTransferIpc } from './transfer'
import { registerSignIpc } from './sign'
import { registerRpcIpc } from './rpc'
import { registerProxyIpc } from './proxy'

function registerVaultIpc(): void {
  handle<void, VaultStatus>(IPC.vaultStatus, () => vault.getStatus())

  handle<{ password: string }, VaultStatus>(IPC.vaultInitialize, (arg) =>
    vault.initialize(requireString(arg?.password, 'password')),
  )

  handle<{ password: string }, VaultStatus>(IPC.vaultUnlock, (arg) =>
    vault.unlock(requireString(arg?.password, 'password')),
  )

  handle<void, VaultStatus>(IPC.vaultLock, () => vault.lock())

  handle<{ oldPassword: string; newPassword: string }, VaultStatus>(
    IPC.vaultChangePassword,
    (arg) =>
      vault.changePassword(
        requireString(arg?.oldPassword, 'oldPassword'),
        requireString(arg?.newPassword, 'newPassword'),
        (oldKek, newKek) => {
          reencryptAuthTokens(oldKek, newKek)
          reencryptWalletSecrets(oldKek, newKek)
        },
      ),
  )

  handle<void, VaultStatus>(IPC.vaultTouch, () => {
    vault.touch()
    return vault.getStatus()
  })
}

function registerSettingsIpc(): void {
  handle<void, AppSettings>(IPC.settingsGet, () => loadSettings())

  handle<Partial<AppSettings>, AppSettings>(IPC.settingsUpdate, (patch) => {
    if (!patch || typeof patch !== 'object') throw invalidArg('settings patch 无效')
    const before = loadSettings()
    const next = saveSettings(patch)
    if (typeof patch.autoLockMinutes === 'number') {
      vault.setAutoLockMinutes(patch.autoLockMinutes)
    }
    if (next.baseUrl !== before.baseUrl) {
      resetBackend()
      broadcast(IPC_EVENT.backendStatusChanged)
    }
    return next
  })
}

function registerBackendIpc(): void {
  handle<void, BackendStatus>(IPC.backendStatus, () => getBackendStatus())

  handle<void, BackendStatus>(IPC.backendAuthenticate, async () => {
    const status = await authenticate()
    broadcast(IPC_EVENT.backendStatusChanged, status)
    return status
  })

  handle<void, boolean>(IPC.backendPing, () => ping())
}

function addressLooksValid(walletType: WalletType, networkScope: 'mainnet' | 'testnet', address: string): boolean {
  if (walletType === 'web3') return isEvmAddress(address) && isChecksumValid(address)
  if (walletType === 'tron') return isTronAddress(address)
  if (walletType === 'solana') return isSolanaAddress(address)
  return isBitcoinAddress(address, networkScope)
}

function normalizeUpsert(input: AddressBookUpsertInput): AddressBookUpsertInput {
  if (!input || typeof input !== 'object') throw invalidArg('地址簿参数无效')

  const label = requireString(input.label, 'label').trim()
  const address = requireString(input.address, 'address').trim()
  const walletType = input.walletType
  if (walletType !== 'bitcoin' && walletType !== 'web3' && walletType !== 'tron' && walletType !== 'solana') {
    throw invalidArg('walletType 无效')
  }
  if (input.networkScope !== 'mainnet' && input.networkScope !== 'testnet') {
    throw invalidArg('networkScope 无效')
  }
  if (!addressLooksValid(walletType, input.networkScope, address)) {
    throw invalidArg('地址格式与所选链不匹配')
  }

  return {
    ...input,
    label,
    address,
    memo: input.memo?.trim() ? input.memo.trim() : null,
    networkPk: input.networkPk ?? null,
    networkName: input.networkName ?? null,
  }
}

function registerAddressBookIpc(): void {
  handle<AddressBookQuery | undefined, AddressBookEntry[]>(IPC.addressBookList, (query) =>
    listAddressBook(query ?? {}),
  )

  handle<AddressBookUpsertInput, AddressBookEntry>(IPC.addressBookUpsert, (input) => {
    const entry = upsertAddressBookEntry(normalizeUpsert(input))
    broadcast(IPC_EVENT.addressBookUpdated)
    return entry
  })

  handle<{ id: string }, true>(IPC.addressBookRemove, (arg) => {
    removeAddressBookEntry(requireString(arg?.id, 'id'))
    broadcast(IPC_EVENT.addressBookUpdated)
    return true
  })

  handle<{ id: string }, true>(IPC.addressBookTouch, (arg) => {
    touchAddressBookEntry(requireString(arg?.id, 'id'))
    return true
  })
}

function registerPlaceholders(): void {
  const done = new Set(listRegistered())
  for (const channel of IPC_CHANNELS) {
    if (!done.has(channel)) handleNotImplemented(channel as IpcChannel)
  }
}

export function registerAllIpc(): void {
  registerVaultIpc()
  registerSettingsIpc()
  registerBackendIpc()
  registerWalletIpc()
  registerCatalogIpc()
  registerPortfolioIpc()
  registerTransferIpc()
  registerSignIpc()
  registerAddressBookIpc()
  registerRpcIpc()
  registerProxyIpc()
  registerPlaceholders()
  initWalletAuth()

  vault.onVaultEvent((event) => {
    if (event === 'unlocked') {
      try {
        hydrateAuthToken()
      } catch {
        /* 没有鉴权钱包或密文失效都不影响解锁本身 */
      }
      void syncCatalog().then((result) => broadcast(IPC_EVENT.catalogUpdated, result)).catch(() => undefined)
    }
    broadcast(event === 'locked' ? IPC_EVENT.vaultLocked : IPC_EVENT.vaultUnlocked, vault.getStatus())
    broadcast(IPC_EVENT.backendStatusChanged)
  })
}
