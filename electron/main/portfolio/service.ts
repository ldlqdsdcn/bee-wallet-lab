/**
 * 资产总览：按当前网络用本地 RPC 拉余额。法币折算不再打公司 tokenInfo。
 */
import type {
  AssetEntry,
  BitcoinAddressType,
  NetworkRecord,
  PortfolioSnapshot,
  TokenRecord,
} from '@shared/types'
import { loadBalances, upsertBalance } from '../db/repos/balanceRepo'
import { getNetwork, listTokens } from '../db/repos/catalogRepo'
import { loadSettings } from '../db/repos/metaRepo'
import { findMatchingAccount } from '../db/repos/accountRepo'
import { getAccount } from '../wallets/service'
import { BITCOIN_ADDRESS_TYPES } from '../derive/paths'
import { invalidArg, notFound } from '../ipc/registry'
import { formatMinor } from '../util/amount'
import { fetchAddressStats } from '../chain/bitcoin'
import { getErc20Balance, getEvmBalance } from '../chain/evm'
import { getTrc20Balance, getTronAccount } from '../chain/tron'
import { getSolBalance, getSplBalance } from '../chain/solana'
import { coinGeckoId, fetchMarketPrices, fiatValue } from '../price'

const BTC_LABEL: Record<BitcoinAddressType, string> = {
  p2pkh: 'Legacy',
  'p2sh-p2wpkh': 'Nested SegWit',
  p2wpkh: 'Native SegWit',
  p2tr: 'Taproot',
}

interface TokenBalance {
  balance: string
  unconfirmed: string | null
}

function nativeToken(tokens: TokenRecord[]): TokenRecord | undefined {
  return tokens.find((item) => !item.isToken) ?? tokens[0]
}

function contractOf(token: TokenRecord): string | null {
  const value = token.contractAddress?.trim() ?? ''
  if (!value || value === '0' || /^0x0+$/i.test(value)) return null
  return value
}

async function fetchChainBalance(
  network: NetworkRecord,
  token: TokenRecord,
  address: string,
): Promise<TokenBalance> {
  if (network.walletType === 'bitcoin') {
    const stats = await fetchAddressStats(address, network.networkScope)
    return {
      balance: formatMinor(stats.confirmed, token.decimals || 8),
      unconfirmed: formatMinor(stats.unconfirmed, token.decimals || 8),
    }
  }
  if (network.walletType === 'web3') {
    const contract = contractOf(token)
    const wei = contract
      ? await getErc20Balance(network, contract, address)
      : await getEvmBalance(network, address)
    return { balance: formatMinor(wei, token.decimals), unconfirmed: null }
  }
  if (network.walletType === 'solana') {
    const mint = contractOf(token)
    const amount = mint ? await getSplBalance(network, address, mint) : await getSolBalance(network, address)
    return { balance: formatMinor(amount, token.decimals), unconfirmed: null }
  }
  const contract = contractOf(token)
  if (!contract) {
    const account = await getTronAccount(address, network.networkScope)
    return { balance: formatMinor(account.balanceSun, token.decimals || 6), unconfirmed: null }
  }
  const amount = await getTrc20Balance(contract, address, network.networkScope)
  return { balance: formatMinor(amount, token.decimals), unconfirmed: null }
}

function entryFromCache(
  token: TokenRecord,
  key: string,
  addressType: BitcoinAddressType | null,
  stale: boolean,
): AssetEntry {
  const cached = loadBalances(token.networkPk, loadSettings().currencyCode).find((row) => row.entry_key === key)
  return {
    key,
    tokenPk: token.id,
    networkPk: token.networkPk,
    symbol: token.symbol,
    name: token.name ?? token.symbol,
    decimals: token.decimals,
    iconUrl: token.tokenIcon,
    isToken: token.isToken,
    contractAddress: contractOf(token),
    addressType,
    address: cached?.address ?? null,
    accountId: cached?.account_id ?? null,
    balance: cached?.balance ?? '0',
    unconfirmed: cached?.unconfirmed ?? null,
    currencyBalance: cached?.currency_balance ?? null,
    updatedAt: cached?.updated_at ?? null,
    stale,
    error: stale ? '使用本地缓存' : null,
  }
}

async function loadEntry(input: {
  network: NetworkRecord
  token: TokenRecord
  key: string
  addressType: BitcoinAddressType | null
  address: string | null
  accountId: string | null
  displayName: string
  currencyCode: string
}): Promise<AssetEntry> {
  const base: AssetEntry = {
    key: input.key,
    tokenPk: input.token.id,
    networkPk: input.token.networkPk,
    symbol: input.token.symbol,
    name: input.displayName,
    decimals: input.token.decimals,
    iconUrl: input.token.tokenIcon,
    isToken: input.token.isToken,
    contractAddress: contractOf(input.token),
    addressType: input.addressType,
    address: input.address,
    accountId: input.accountId,
    balance: '0',
    unconfirmed: null,
    currencyBalance: null,
    updatedAt: Date.now(),
    stale: false,
    error: null,
  }
  if (!input.address) return base

  try {
    const info = await fetchChainBalance(input.network, input.token, input.address)
    base.balance = info.balance
    base.unconfirmed = info.unconfirmed
    upsertBalance({
      entry_key: input.key,
      network_pk: input.token.networkPk,
      token_pk: input.token.id,
      account_id: input.accountId,
      address: input.address,
      address_type: input.addressType,
      balance: base.balance,
      unconfirmed: base.unconfirmed,
      currency_code: input.currencyCode,
      currency_balance: null,
      updated_at: base.updatedAt ?? Date.now(),
    })
    return base
  } catch (err) {
    const cached = entryFromCache(input.token, input.key, input.addressType, true)
    cached.name = input.displayName
    cached.address = input.address
    cached.accountId = input.accountId
    cached.error = err instanceof Error ? err.message : String(err)
    cached.stale = true
    return cached
  }
}

async function applyFiatPrices(
  entries: AssetEntry[],
  tokens: TokenRecord[],
  network: NetworkRecord,
  currencyCode: string,
): Promise<string | null> {
  const tokenByPk = new Map(tokens.map((item) => [item.id, item]))
  const ids = new Set<string>(['bitcoin', 'ethereum'])
  for (const entry of entries) {
    const token = tokenByPk.get(entry.tokenPk)
    const id = token ? coinGeckoId(token, network) : SYMBOL_FALLBACK[entry.symbol.toLowerCase()]
    if (id) ids.add(id)
  }

  let prices: Map<string, number>
  try {
    prices = await fetchMarketPrices([...ids], currencyCode)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }

  for (const entry of entries) {
    const token = tokenByPk.get(entry.tokenPk)
    const id = token ? coinGeckoId(token, network) : SYMBOL_FALLBACK[entry.symbol.toLowerCase()]
    const price = id ? prices.get(id) : undefined
    if (price == null) continue
    const fiat = fiatValue(entry.balance, price)
    if (fiat == null) continue
    entry.currencyBalance = fiat
    upsertBalance({
      entry_key: entry.key,
      network_pk: entry.networkPk,
      token_pk: entry.tokenPk,
      account_id: entry.accountId,
      address: entry.address,
      address_type: entry.addressType,
      balance: entry.balance,
      unconfirmed: entry.unconfirmed,
      currency_code: currencyCode,
      currency_balance: fiat,
      updated_at: entry.updatedAt ?? Date.now(),
    })
  }
  return null
}

const SYMBOL_FALLBACK: Record<string, string> = {
  btc: 'bitcoin',
  eth: 'ethereum',
}

export async function getPortfolioSnapshot(networkPk?: string): Promise<PortfolioSnapshot> {
  const settings = loadSettings()
  const pk = networkPk ?? settings.defaultNetworkPk
  if (!pk) throw invalidArg('还没有可用网络，请先在设置页同步目录')
  const network = getNetwork(pk)
  if (!network) throw notFound('网络不存在，请重新同步目录')

  const tokens = listTokens(pk)
  if (tokens.length === 0) {
    return { networkPk: pk, currencyCode: settings.currencyCode, totalCurrency: '0', entries: [], offline: true }
  }

  const entries: AssetEntry[] = []
  if (network.walletType === 'bitcoin') {
    const base = nativeToken(tokens)
    if (!base) {
      return { networkPk: pk, currencyCode: settings.currencyCode, totalCurrency: null, entries: [], offline: false }
    }
    for (const addressType of BITCOIN_ADDRESS_TYPES) {
      const account = findMatchingAccount({
        walletType: 'bitcoin',
        networkScope: network.networkScope,
        addressType,
      })
      entries.push(
        await loadEntry({
          network,
          token: base,
          key: `${base.id}:${network.networkScope}:${addressType}`,
          addressType,
          address: account?.address ?? null,
          accountId: account?.id ?? null,
          displayName: `${base.symbol} ${BTC_LABEL[addressType]}`,
          currencyCode: settings.currencyCode,
        }),
      )
    }
  } else {
    for (const token of tokens) {
      const account = findMatchingAccount({
        walletType: network.walletType,
        networkScope: network.networkScope,
      })
      entries.push(
        await loadEntry({
          network,
          token,
          key: token.id,
          addressType: null,
          address: account?.address ?? null,
          accountId: account?.id ?? null,
          displayName: token.name ?? token.symbol,
          currencyCode: settings.currencyCode,
        }),
      )
    }
  }

  const priceError = await applyFiatPrices(entries, tokens, network, settings.currencyCode)

  const priced = entries.filter((item) => item.currencyBalance != null)
  const total = priced.reduce((sum, item) => {
    const value = Number(item.currencyBalance ?? 0)
    return Number.isFinite(value) ? sum + value : sum
  }, 0)

  return {
    networkPk: pk,
    currencyCode: settings.currencyCode,
    totalCurrency: priced.length ? total.toFixed(2) : null,
    entries,
    offline: entries.some((item) => item.stale),
    priceError,
  }
}

/** 指定账户在某条网上的代币余额，供兑换 / 跨链桥展示。 */
export async function getAccountPortfolio(accountId: string, networkPk: string): Promise<AssetEntry[]> {
  const settings = loadSettings()
  const network = getNetwork(networkPk)
  if (!network) throw notFound('网络不存在，请先同步目录')
  const account = getAccount(accountId)
  if (account.walletType !== network.walletType) throw invalidArg('账户与所选网络不匹配')
  const tokens = listTokens(networkPk)
  if (network.walletType === 'bitcoin') {
    const base = nativeToken(tokens)
    if (!base) return []
    return [
      await loadEntry({
        network,
        token: base,
        key: `${base.id}:${account.id}`,
        addressType: account.addressType,
        address: account.address,
        accountId: account.id,
        displayName: base.symbol,
        currencyCode: settings.currencyCode,
      }),
    ]
  }
  const entries: AssetEntry[] = []
  for (const token of tokens) {
    entries.push(
      await loadEntry({
        network,
        token,
        key: `${token.id}:${account.id}`,
        addressType: null,
        address: account.address,
        accountId: account.id,
        displayName: token.name ?? token.symbol,
        currencyCode: settings.currencyCode,
      }),
    )
  }
  return entries
}
