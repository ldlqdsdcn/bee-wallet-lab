/**
 * 钱包服务：创建 / 导入 / 导出 / 多账户派生 / 私钥导入。
 *
 * 私钥与助记词只在本模块内短暂出现，用完即 wipe。
 */
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import {
  BITCOIN_ADDRESS_TYPES,
  derive,
  deriveAddress,
  deriveHdRange,
  deriveFromPrivateKey,
  normalizeHdRange,
  generateMnemonicPhrase,
  resolveAddressType,
  assertMnemonic,
  mnemonicToSeed,
  mnemonicWordCount,
  masterFingerprint,
  privateKeyToWif,
  encodeSolanaSecretKey,
} from '../derive'
import { newId, wipe } from '../security/crypto'
import { verifyPassword } from '../security/vault'
import { loadSettings, saveSettings } from '../db/repos/metaRepo'
import {
  countAccounts,
  decryptImportedPrivateKey,
  deleteAccount,
  findAccountByAddress,
  findNextAddressIndex,
  getAccountRow,
  insertAccount,
  listAccountRows,
  reencryptImportedAccounts,
  toAccountRecord,
  updateAccountLabel,
  type AccountRow,
} from '../db/repos/accountRepo'
import {
  clearAuthWallets,
  decryptWalletSecrets,
  deleteWallet,
  findWalletByFingerprint,
  getDefaultWalletRow,
  getWalletRow,
  insertWallet,
  listWalletPickerPage,
  listWalletRows,
  reencryptWallets,
  setAuthWalletFlag,
  setDefaultWallet,
  toWalletSummary,
  updateWalletName,
  type WalletRow,
} from '../db/repos/walletRepo'
import { withTransaction } from '../db/sqlite'
import { IpcError, invalidArg, notFound } from '../ipc/registry'
import { normalizePickerQuery } from './query'
import {
  decryptHdPrivateKey,
  deleteHdKeys,
  getHdKeyRow,
  listExistingHdIndexes,
  listHdKeyRows,
  listHdKeys,
  reencryptHdKeys,
  upsertHdKeys,
} from '../db/repos/hdKeyRepo'
import type {
  AccountRecord,
  BitcoinAddressType,
  CreateWalletInput,
  DeriveAccountInput,
  DerivedAddress,
  HdDerivedEvmKey,
  HdDeriveEvmInput,
  HdDeriveEvmResult,
  HdKeyQuery,
  HdKeyRecord,
  ImportPrivateKeyInput,
  ImportWalletInput,
  MnemonicDraft,
  NetworkScope,
  WalletPickerPage,
  WalletPickerQuery,
  WalletSummary,
  WalletType,
} from '@shared/types'

interface DraftState {
  mnemonic: string
  name: string
  passphrase: string | null
  challengeIndexes: number[]
  createdAt: number
}

const DRAFT_TTL_MS = 10 * 60 * 1000
const drafts = new Map<string, DraftState>()

const DEFAULT_DERIVATIONS: Array<{
  walletType: WalletType
  networkScope: NetworkScope
  addressType: BitcoinAddressType | null
  label: string
}> = [
  { walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2pkh', label: 'BTC Legacy' },
  {
    walletType: 'bitcoin',
    networkScope: 'mainnet',
    addressType: 'p2sh-p2wpkh',
    label: 'BTC Nested SegWit',
  },
  { walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2wpkh', label: 'BTC Native SegWit' },
  { walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2tr', label: 'BTC Taproot' },
  { walletType: 'web3', networkScope: 'mainnet', addressType: null, label: 'EVM' },
  { walletType: 'tron', networkScope: 'mainnet', addressType: null, label: 'TRON' },
  { walletType: 'solana', networkScope: 'mainnet', addressType: null, label: 'Solana' },
]

function requireWallet(id: string): WalletRow {
  const row = getWalletRow(id)
  if (!row) throw notFound('钱包不存在')
  return row
}

function requireAccount(id: string): AccountRow {
  const row = getAccountRow(id)
  if (!row) throw notFound('账户不存在')
  return row
}

function pickChallengeIndexes(wordCount: number, count = 3): number[] {
  const pool = Array.from({ length: wordCount }, (_, i) => i + 1)
  const picked: number[] = []
  while (picked.length < Math.min(count, wordCount)) {
    const index = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(index, 1)[0])
  }
  return picked.sort((a, b) => a - b)
}

function pruneDrafts(now = Date.now()): void {
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) drafts.delete(id)
  }
}

function persistDerivedAccounts(walletId: string, seed: Uint8Array): void {
  for (const spec of DEFAULT_DERIVATIONS) {
    const derived = deriveAddress({
      seed,
      walletType: spec.walletType,
      networkScope: spec.networkScope,
      addressType: spec.addressType,
    })
    insertAccount({
      id: newId(),
      walletId,
      walletType: spec.walletType,
      networkScope: spec.networkScope,
      addressType: derived.addressType,
      rootPath: derived.rootPath,
      accountIndex: derived.accountIndex,
      addressIndex: derived.addressIndex,
      address: derived.address,
      publicKey: derived.publicKey,
      label: spec.label,
      source: 'hd',
    })
  }
}

function persistWalletFromMnemonic(input: {
  name: string
  mnemonic: string
  passphrase?: string | null
}): WalletSummary {
  const mnemonic = assertMnemonic(input.mnemonic)
  const passphrase = input.passphrase?.trim() ? input.passphrase : null
  const seed = mnemonicToSeed(mnemonic, passphrase ?? undefined)
  try {
    const fingerprint = masterFingerprint(seed)
    const existing = findWalletByFingerprint(fingerprint)
    if (existing) throw invalidArg('该助记词已经导入过，请直接使用已有钱包')

    const wallets = listWalletRows()
    const isFirst = wallets.length === 0
    const id = newId()

    return withTransaction(() => {
      insertWallet({
        id,
        name: input.name.trim() || `钱包 ${wallets.length + 1}`,
        mnemonicLength: mnemonicWordCount(mnemonic),
        mnemonic,
        passphrase,
        fingerprint,
        isDefault: isFirst,
        isAuthWallet: isFirst,
      })
      persistDerivedAccounts(id, seed)
      if (isFirst) saveSettings({ defaultWalletId: id })
      return getWalletSummary(id)
    })
  } finally {
    wipe(seed)
  }
}

export function listWallets(): WalletSummary[] {
  return listWalletRows().map((row) => toWalletSummary(row, countAccounts(row.id)))
}

export function getCurrentWallet(): WalletSummary | null {
  const settingsId = loadSettings().defaultWalletId
  const row = (settingsId ? getWalletRow(settingsId) : null) ?? getDefaultWalletRow()
  return row ? toWalletSummary(row, countAccounts(row.id)) : null
}

export function listWalletPicker(input: WalletPickerQuery = {}): WalletPickerPage {
  const query = normalizePickerQuery(input)
  const currencyCode = loadSettings().currencyCode
  const { items, total } = listWalletPickerPage({ ...query, currencyCode })
  const pageSize = query.pageSize
  const maxPage = Math.max(1, Math.ceil(total / pageSize) || 1)
  return {
    items,
    total,
    page: Math.min(query.page, maxPage),
    pageSize,
    currencyCode,
  }
}

export function getWalletSummary(id: string): WalletSummary {
  const row = requireWallet(id)
  return toWalletSummary(row, countAccounts(row.id))
}

export function createWalletDraft(input: CreateWalletInput): MnemonicDraft {
  pruneDrafts()
  const name = input.name?.trim()
  if (!name) throw invalidArg('钱包名称不能为空')
  const wordCount = input.mnemonicLength === 24 ? 24 : 12
  const mnemonic = generateMnemonicPhrase(wordCount)
  const words = mnemonic.split(' ')
  const draftId = newId()
  const challengeIndexes = pickChallengeIndexes(words.length)
  drafts.set(draftId, {
    mnemonic,
    name,
    passphrase: input.passphrase?.trim() ? input.passphrase : null,
    challengeIndexes,
    createdAt: Date.now(),
  })
  return { draftId, words, challengeIndexes }
}

export function confirmWalletDraft(input: {
  draftId: string
  answers: Record<string, string> | Array<{ index: number; word: string }>
}): WalletSummary {
  pruneDrafts()
  const draft = drafts.get(input.draftId)
  if (!draft) throw invalidArg('助记词草稿已过期，请重新生成')

  const words = draft.mnemonic.split(' ')
  const answers = Array.isArray(input.answers)
    ? Object.fromEntries(input.answers.map((item) => [String(item.index), item.word]))
    : input.answers

  for (const index of draft.challengeIndexes) {
    const expected = words[index - 1]
    const actual = (answers[String(index)] ?? '').trim().toLowerCase()
    if (actual !== expected) throw invalidArg(`第 ${index} 个单词不正确`)
  }

  try {
    return persistWalletFromMnemonic({
      name: draft.name,
      mnemonic: draft.mnemonic,
      passphrase: draft.passphrase,
    })
  } finally {
    drafts.delete(input.draftId)
  }
}

export function importMnemonic(input: ImportWalletInput): WalletSummary {
  const name = input.name?.trim()
  if (!name) throw invalidArg('钱包名称不能为空')
  return persistWalletFromMnemonic({
    name,
    mnemonic: input.mnemonic,
    passphrase: input.passphrase,
  })
}

export function validateMnemonicPhrase(mnemonic: string): { valid: boolean; wordCount: number | null } {
  try {
    const normalized = assertMnemonic(mnemonic)
    return { valid: true, wordCount: mnemonicWordCount(normalized) }
  } catch {
    return { valid: false, wordCount: null }
  }
}

export function exportMnemonic(walletId: string, password: string): { mnemonic: string; passphrase: string | null } {
  if (!verifyPassword(password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  const row = requireWallet(walletId)
  return decryptWalletSecrets(row)
}

export function renameWallet(walletId: string, name: string): WalletSummary {
  const trimmed = name.trim()
  if (!trimmed) throw invalidArg('钱包名称不能为空')
  requireWallet(walletId)
  updateWalletName(walletId, trimmed)
  return getWalletSummary(walletId)
}

export function markDefaultWallet(walletId: string): WalletSummary {
  requireWallet(walletId)
  setDefaultWallet(walletId)
  saveSettings({ defaultWalletId: walletId })
  return getWalletSummary(walletId)
}

export function markAuthWallet(walletId: string): WalletSummary {
  requireWallet(walletId)
  const accounts = listAccountRows(walletId).filter((row) => row.wallet_type === 'web3')
  if (accounts.length === 0) throw invalidArg('鉴权钱包需要至少一个 EVM 账户')
  setAuthWalletFlag(walletId)
  return getWalletSummary(walletId)
}

export function removeWallet(walletId: string, password: string): true {
  if (!verifyPassword(password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  const row = requireWallet(walletId)
  deleteWallet(walletId)
  const remaining = listWalletRows()
  if (row.is_default === 1 && remaining[0]) {
    setDefaultWallet(remaining[0].id)
    saveSettings({ defaultWalletId: remaining[0].id })
  }
  if (row.is_auth_wallet === 1 && remaining[0]) {
    const candidate =
      remaining.find((item) => listAccountRows(item.id).some((acc) => acc.wallet_type === 'web3')) ??
      remaining[0]
    setAuthWalletFlag(candidate.id)
  }
  if (remaining.length === 0) {
    clearAuthWallets()
    saveSettings({ defaultWalletId: null })
  }
  return true
}

export function listAccounts(walletId?: string | null): AccountRecord[] {
  return listAccountRows(walletId).map(toAccountRecord)
}

export function previewDerivation(input: DeriveAccountInput): DerivedAddress {
  const wallet = requireWallet(input.walletId)
  const secrets = decryptWalletSecrets(wallet)
  const seed = mnemonicToSeed(secrets.mnemonic, secrets.passphrase ?? undefined)
  try {
    return deriveAddress({
      seed,
      walletType: input.walletType,
      networkScope: input.networkScope,
      addressType: input.addressType,
      accountIndex: input.accountIndex,
      addressIndex: input.addressIndex,
      customPath: input.customPath,
    })
  } finally {
    wipe(seed)
  }
}

export function deriveAccount(input: DeriveAccountInput): AccountRecord {
  const wallet = requireWallet(input.walletId)
  const secrets = decryptWalletSecrets(wallet)
  const seed = mnemonicToSeed(secrets.mnemonic, secrets.passphrase ?? undefined)
  try {
    const accountIndex = input.accountIndex ?? 0
    const addressIndex =
      input.addressIndex ??
      (input.customPath
        ? 0
        : findNextAddressIndex(
            input.walletId,
            input.walletType,
            input.networkScope,
            input.addressType ?? null,
            accountIndex,
          ))
    const derived = derive({
      seed,
      walletType: input.walletType,
      networkScope: input.networkScope,
      addressType: input.addressType,
      accountIndex,
      addressIndex,
      customPath: input.customPath,
    })
    wipe(derived.privateKey)
    const duplicate = findAccountByAddress(derived.walletType, derived.networkScope, derived.address)
    if (duplicate) throw invalidArg('该地址已经存在')
    const row = insertAccount({
      id: newId(),
      walletId: input.walletId,
      walletType: derived.walletType,
      networkScope: derived.networkScope,
      addressType: derived.addressType,
      rootPath: derived.rootPath,
      accountIndex: derived.accountIndex,
      addressIndex: derived.addressIndex,
      address: derived.address,
      publicKey: derived.publicKey,
      label: input.label?.trim() || defaultAccountLabel(derived.walletType, derived.addressType),
      source: 'hd',
    })
    return toAccountRecord(row)
  } finally {
    wipe(seed)
  }
}

export function importPrivateKey(input: ImportPrivateKeyInput): AccountRecord {
  const imported = deriveFromPrivateKey({
    walletType: input.walletType,
    networkScope: input.networkScope,
    addressType: input.addressType,
    privateKey: input.privateKey,
  })
  try {
    const duplicate = findAccountByAddress(imported.walletType, imported.networkScope, imported.address)
    if (duplicate) throw invalidArg('该地址已经存在')
    const row = insertAccount({
      id: newId(),
      walletId: null,
      walletType: imported.walletType,
      networkScope: imported.networkScope,
      addressType: imported.addressType,
      rootPath: null,
      accountIndex: 0,
      addressIndex: 0,
      address: imported.address,
      publicKey: imported.publicKey,
      label: input.label?.trim() || '导入账户',
      source: 'imported',
      privateKeyHex: bytesToHex(imported.privateKey),
    })
    return toAccountRecord(row)
  } finally {
    wipe(imported.privateKey)
  }
}

function hdStorageScope(walletType: WalletType, networkScope: NetworkScope): NetworkScope {
  return walletType === 'bitcoin' ? networkScope : 'mainnet'
}

export function batchDeriveHd(input: HdDeriveEvmInput): HdDeriveEvmResult {
  if (!verifyPassword(input.password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  const wallet = requireWallet(input.walletId)
  const walletType = input.walletType ?? 'web3'
  const networkScope = input.networkScope ?? 'mainnet'
  const addressType = walletType === 'bitcoin' ? resolveAddressType('bitcoin', input.addressType) : null
  const storedScope = hdStorageScope(walletType, networkScope)
  const fromIndex = input.fromIndex ?? 1
  const toIndex = input.toIndex
  const accountIndex = input.accountIndex ?? 0
  let range: { fromIndex: number; toIndex: number }
  try {
    range = normalizeHdRange(fromIndex, toIndex)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : '派生范围不合法')
  }
  const existing = listExistingHdIndexes(
    wallet.id,
    walletType,
    accountIndex,
    range.fromIndex,
    range.toIndex,
    storedScope,
    addressType,
  )
  const requested = range.toIndex - range.fromIndex + 1
  if (existing.length >= requested) {
    throw invalidArg(`第 ${range.fromIndex}–${range.toIndex} 号已经生成过，无需重复执行`)
  }

  const secrets = decryptWalletSecrets(wallet)
  const seed = mnemonicToSeed(secrets.mnemonic, secrets.passphrase ?? undefined)
  try {
    const derived = deriveHdRange({
      seed,
      walletType,
      networkScope,
      addressType,
      accountIndex,
      fromIndex: range.fromIndex,
      toIndex: range.toIndex,
      skipIndexes: existing,
    })
    const saved = upsertHdKeys(wallet.id, walletType, accountIndex, storedScope, addressType, derived)
    return {
      walletId: wallet.id,
      walletName: wallet.name,
      accountIndex,
      fromIndex: range.fromIndex,
      toIndex: range.toIndex,
      saved,
      skipped: existing.length,
      rows: derived,
    }
  } finally {
    wipe(seed)
  }
}

export const batchDeriveEvm = batchDeriveHd

export function revealPrivateKey(accountId: string, password: string): string {
  if (!verifyPassword(password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  const account = requireAccount(accountId)
  return withAccountPrivateKey(account, (privateKey) => {
    if (account.wallet_type === 'bitcoin') {
      return privateKeyToWif(privateKey, account.network_scope as NetworkScope)
    }
    if (account.wallet_type === 'solana') {
      return encodeSolanaSecretKey(privateKey)
    }
    return `0x${bytesToHex(privateKey)}`
  })
}

export function renameAccount(accountId: string, label: string): AccountRecord {
  const trimmed = label.trim()
  if (!trimmed) throw invalidArg('账户名称不能为空')
  requireAccount(accountId)
  updateAccountLabel(accountId, trimmed)
  return toAccountRecord(requireAccount(accountId))
}

export function removeAccount(accountId: string): true {
  const account = requireAccount(accountId)
  if (account.source === 'hd' && account.wallet_id) {
    const siblings = listAccountRows(account.wallet_id)
    if (siblings.length <= 1) throw invalidArg('不能删除钱包的最后一个账户，请改为删除钱包')
  }
  deleteAccount(accountId)
  return true
}

export function getAccount(accountId: string): AccountRecord {
  return toAccountRecord(requireAccount(accountId))
}

function defaultAccountLabel(walletType: WalletType, addressType: BitcoinAddressType | null): string {
  if (walletType === 'bitcoin') {
    const labels: Record<BitcoinAddressType, string> = {
      p2pkh: 'BTC Legacy',
      'p2sh-p2wpkh': 'BTC Nested SegWit',
      p2wpkh: 'BTC Native SegWit',
      p2tr: 'BTC Taproot',
    }
    return addressType ? labels[addressType] : 'BTC'
  }
  if (walletType === 'tron') return 'TRON'
  if (walletType === 'solana') return 'Solana'
  return 'EVM'
}

export function withAccountPrivateKey<T>(account: AccountRow, fn: (privateKey: Uint8Array) => T): T {
  if (account.source === 'imported') {
    const hex = decryptImportedPrivateKey(account)
    const privateKey = hexToBytes(hex.replace(/^0x/, ''))
    try {
      return fn(privateKey)
    } finally {
      wipe(privateKey)
    }
  }
  if (!account.wallet_id) throw invalidArg('账户缺少所属钱包')
  const wallet = requireWallet(account.wallet_id)
  const secrets = decryptWalletSecrets(wallet)
  const seed = mnemonicToSeed(secrets.mnemonic, secrets.passphrase ?? undefined)
  try {
    const derived = derive({
      seed,
      walletType: account.wallet_type as WalletType,
      networkScope: account.network_scope as NetworkScope,
      addressType: (account.address_type as BitcoinAddressType | null) ?? undefined,
      accountIndex: account.account_index,
      addressIndex: account.address_index,
      customPath: account.root_path ?? undefined,
    })
    try {
      return fn(derived.privateKey)
    } finally {
      wipe(derived.privateKey)
    }
  } finally {
    wipe(seed)
  }
}

export function listHdKeyTable(query: HdKeyQuery): HdKeyRecord[] {
  requireWallet(query.walletId)
  return listHdKeys(query)
}

export function unlockHdKeyTable(query: HdKeyQuery & { password: string }): HdDerivedEvmKey[] {
  if (!verifyPassword(query.password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  requireWallet(query.walletId)
  return listHdKeyRows(query).map((row) => ({
    id: row.id,
    index: row.address_index,
    path: row.root_path,
    address: row.address,
    publicKey: row.public_key,
    privateKey: decryptHdPrivateKey(row),
  }))
}

export function revealHdKey(walletId: string, keyId: string, password: string): HdDerivedEvmKey {
  if (!verifyPassword(password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  requireWallet(walletId)
  const row = getHdKeyRow(keyId)
  if (!row || row.wallet_id !== walletId) throw notFound('分层记录不存在')
  return {
    id: row.id,
    index: row.address_index,
    path: row.root_path,
    address: row.address,
    publicKey: row.public_key,
    privateKey: decryptHdPrivateKey(row),
  }
}

export function clearHdKeyTable(query: HdKeyQuery & { password: string }): number {
  if (!verifyPassword(query.password)) throw new IpcError('INVALID_ARG', '主密码不正确')
  requireWallet(query.walletId)
  return deleteHdKeys(query)
}

export function reencryptWalletSecrets(oldKek: Buffer, newKek: Buffer): void {
  reencryptWallets(oldKek, newKek)
  reencryptImportedAccounts(oldKek, newKek)
  reencryptHdKeys(oldKek, newKek)
}

export { BITCOIN_ADDRESS_TYPES }
