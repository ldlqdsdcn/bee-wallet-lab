/**
 * 转账：预览（构建未签名意图）、只签名、以及签名后直连节点广播。
 */
import type {
  AccountRecord,
  BroadcastResult,
  FeeLevel,
  NetworkRecord,
  TokenRecord,
  TransferDraftInput,
  TransferEnergyInfo,
  TransferPreview,
  TronEnergyFeeMode,
  TxLabSigned,
} from '@shared/types'
import { newId } from '../security/crypto'
import { parseDecimalToMinor, formatMinor } from '../util/amount'
import { getNetwork, getToken } from '../db/repos/catalogRepo'
import { getAccountRow, listMatchingAccounts } from '../db/repos/accountRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import {
  bitcoinTxidFromHex,
  buildAndSignBitcoinTx,
  estimateVsize,
  fetchFeeRates,
  fetchUtxos,
} from '../chain/bitcoin'
import {
  encodeErc20Transfer,
  estimateEvmGas,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
  type EvmFeeQuote,
} from '../chain/evm'
import {
  createTrc20Tx,
  createTronNativeTx,
  estimateTrc20Energy,
  estimateTronNativeFeeSun,
  getTronAccount,
  getTronEnergyFeeSun,
  signTronTx,
} from '../chain/tron'
import { getBaseUrl } from '../backend/config'
import { estimateEnergyOrder } from '../energy/api'
import { loadEnergyResources, rentEnergyAndWait } from '../energy/service'
import { burnSunForEnergy, compareEnergyFees, rentQuantity, requiredEnergy, sunToTrx } from '../energy/codec'
import { buildAndSignSolanaTx, quoteSolanaFee } from '../chain/solana'
import { decodeRawTransaction } from '../txLab/decode'
import { broadcastRawOnNetwork, feeDecimalsOf, persistBroadcastedTx } from '../txLab/service'
import { isBitcoinAddress } from '../derive/bitcoin'
import { isEvmAddress, toChecksumAddress } from '../derive/evm'
import { isTronAddress } from '../derive/tron'
import { isSolanaAddress } from '../derive/solana'
import { loadSettings } from '../db/repos/metaRepo'

interface StoredDraft {
  input: TransferDraftInput
  preview: TransferPreview
  network: NetworkRecord
  token: TokenRecord
  account: AccountRecord
  amountMinor: bigint
  feeMinor: bigint
  feeRate?: number
  evmFee?: EvmFeeQuote
  gasLimit?: bigint
  nonce?: number
  data?: `0x${string}`
  to: string
  feeLimitSun?: bigint
  energyFeeMode?: TronEnergyFeeMode
  energyQuantity?: number
  createdAt: number
}

const drafts = new Map<string, StoredDraft>()
const DRAFT_TTL_MS = 10 * 60 * 1000

function pruneDrafts(): void {
  const now = Date.now()
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) drafts.delete(id)
  }
}

function requireNetwork(id: string): NetworkRecord {
  const network = getNetwork(id)
  if (!network) throw notFound('网络不存在，请先同步目录')
  return network
}

function requireToken(id: string): TokenRecord {
  const token = getToken(id)
  if (!token) throw notFound('代币不存在，请先同步目录')
  return token
}

function requireAccountRow(id: string) {
  const row = getAccountRow(id)
  if (!row) throw notFound('付款账户不存在')
  return row
}

function contractOf(token: TokenRecord): string | null {
  const value = token.contractAddress?.trim() ?? ''
  if (!value || value === '0' || /^0x0+$/i.test(value)) return null
  return value
}

function validateAddress(network: NetworkRecord, address: string): string {
  const trimmed = address.trim()
  if (network.walletType === 'bitcoin' && !isBitcoinAddress(trimmed, network.networkScope)) {
    throw invalidArg('收款地址不是有效的 Bitcoin 地址')
  }
  if (network.walletType === 'web3' && !isEvmAddress(trimmed)) {
    throw invalidArg('收款地址不是有效的 EVM 地址')
  }
  if (network.walletType === 'tron' && !isTronAddress(trimmed)) {
    throw invalidArg('收款地址不是有效的 TRON 地址')
  }
  if (network.walletType === 'solana' && !isSolanaAddress(trimmed)) {
    throw invalidArg('收款地址不是有效的 Solana 地址')
  }
  return network.walletType === 'web3' ? toChecksumAddress(trimmed) : trimmed
}

function feeRateOf(level: FeeLevel, rates: { low: number; medium: number; high: number }, custom?: string): number {
  if (level === 'custom') {
    const parsed = Number(custom)
    if (!Number.isFinite(parsed) || parsed <= 0) throw invalidArg('自定义费率不合法')
    return parsed
  }
  return rates[level]
}

export async function previewTransfer(input: TransferDraftInput): Promise<TransferPreview> {
  pruneDrafts()
  const network = requireNetwork(input.networkPk)
  const token = requireToken(input.tokenPk)
  const account = getAccount(input.accountId)
  if (account.walletType !== network.walletType) throw invalidArg('付款账户与所选网络不匹配')
  if (network.walletType === 'bitcoin' && account.networkScope !== network.networkScope) {
    throw invalidArg('付款账户与网络环境不匹配')
  }
  const to = validateAddress(network, input.to)
  const amountMinor = input.sendMax ? 0n : parseDecimalToMinor(input.amount, token.decimals)
  if (!input.sendMax && amountMinor <= 0n) throw invalidArg('转账金额必须大于 0')

  if (network.walletType === 'bitcoin') {
    if (token.isToken) throw invalidArg('Bitcoin 网络仅支持原生 BTC 转账')
    if (!account.addressType) throw invalidArg('Bitcoin 账户缺少地址格式')
    const rates = await fetchFeeRates(network.networkScope)
    const feeRate = feeRateOf(input.feeLevel, rates, input.customFeeRate)
    const utxos = await fetchUtxos(account.address, network.networkScope)
    const total = utxos.reduce((sum, item) => sum + BigInt(item.valueSats), 0n)
    const vsize = estimateVsize(account.addressType, Math.max(utxos.length, 1), input.sendMax ? 1 : 2)
    const feeMinor = BigInt(Math.ceil(vsize * feeRate * 1.2))
    const sendAmount = input.sendMax ? total - feeMinor : amountMinor
    if (sendAmount <= 0n) throw invalidArg('余额不足以支付矿工费')
    const preview = buildPreview({
      account,
      to,
      token,
      amountMinor: sendAmount,
      feeMinor,
      feeText: `${formatMinor(feeMinor, 8)} BTC @ ${feeRate.toFixed(1)} sat/vB`,
      detail: {
        addressType: account.addressType,
        feeRate: String(feeRate),
        utxoCount: String(utxos.length),
        vsize: String(vsize),
      },
      warnings: utxos.length === 0 ? ['当前地址没有可用 UTXO'] : [],
    })
    drafts.set(preview.draftId, {
      input,
      preview,
      network,
      token,
      account,
      amountMinor: sendAmount,
      feeMinor,
      feeRate,
      to,
      createdAt: Date.now(),
    })
    return preview
  }

  if (network.walletType === 'web3') {
    const contract = contractOf(token)
    const value = contract ? 0n : amountMinor
    const data = contract ? encodeErc20Transfer(to, amountMinor) : undefined
    const quotes = await quoteEvmFees(network)
    const quote = resolveEvmFeeQuote(quotes, input)
    const gasLimit = input.gasLimit
      ? BigInt(input.gasLimit)
      : await estimateEvmGas({ network, from: account.address, to: contract ?? to, value, data })
    const feeMinor = (quote.maxFeePerGas || quote.gasPrice || 0n) * gasLimit
    const preview = buildPreview({
      account,
      to,
      token,
      amountMinor,
      feeMinor,
      feeText: `${formatMinor(feeMinor, 18)} ${network.coinEasy ?? 'ETH'}`,
      detail: {
        chainId: network.chainId,
        gasLimit: gasLimit.toString(),
        maxFeePerGas: quote.maxFeePerGas.toString(),
        eip1559: String(quote.eip1559),
        contract: contract ?? '',
      },
      warnings: [],
    })
    drafts.set(preview.draftId, {
      input,
      preview,
      network,
      token,
      account,
      amountMinor,
      feeMinor,
      evmFee: quote,
      gasLimit,
      data,
      to,
      createdAt: Date.now(),
    })
    return preview
  }

  if (network.walletType === 'solana') {
    const mint = contractOf(token)
    const quote = await quoteSolanaFee(network, to, mint)
    const preview = buildPreview({
      account,
      to,
      token,
      amountMinor,
      feeMinor: quote.feeLamports,
      feeText: `${formatMinor(quote.feeLamports, 9)} SOL`,
      detail: {
        mint: mint ?? '',
        createAta: String(quote.createAta),
      },
      warnings: quote.createAta ? ['收款地址还没有该代币账户，转账会代为创建 Associated Token Account'] : [],
    })
    drafts.set(preview.draftId, {
      input,
      preview,
      network,
      token,
      account,
      amountMinor,
      feeMinor: quote.feeLamports,
      to,
      createdAt: Date.now(),
    })
    return preview
  }

  const contract = contractOf(token)
  const recipient = await getTronAccount(to, network.networkScope)
  const feeLimitSun = input.feeLimit ? parseDecimalToMinor(input.feeLimit, 6) : 40_000_000n
  const feeMinor = contract ? feeLimitSun : estimateTronNativeFeeSun(recipient.active)
  const warnings = recipient.active ? [] : ['收款地址尚未激活，转账将额外消耗约 1.1 TRX']
  const energy = contract
    ? await resolveTrc20Energy({
        accountId: account.id,
        network,
        from: account.address,
        to,
        contract,
        amount: amountMinor,
        tokenGasLimit: token.gasLimit,
        preferredMode: input.energyFeeMode,
      })
    : undefined
  const preview = buildPreview({
    account,
    to,
    token,
    amountMinor,
    feeMinor: energyFeeMinor(energy, feeMinor),
    feeText: energy
      ? energy.short
        ? energyFeeText(energy)
        : `能量足够（剩余 ${energy.left}）`
      : `${formatMinor(feeMinor, 6)} TRX`,
    detail: {
      recipientActive: String(recipient.active),
      contract: contract ?? '',
      feeLimitSun: feeLimitSun.toString(),
      energyRequired: energy ? String(energy.required) : '',
      energyLeft: energy ? String(energy.left) : '',
    },
    warnings,
    energy,
  })
  drafts.set(preview.draftId, {
    input,
    preview,
    network,
    token,
    account,
    amountMinor,
    feeMinor: energyFeeMinor(energy, feeMinor),
    feeLimitSun,
    energyFeeMode: energy?.selected,
    energyQuantity: energy?.short ? (energy.quote?.quantity ?? 0) : 0,
    to,
    createdAt: Date.now(),
  })
  return preview
}

async function resolveTrc20Energy(input: {
  accountId: string
  network: NetworkRecord
  from: string
  to: string
  contract: string
  amount: bigint
  tokenGasLimit: number | null
  preferredMode?: TronEnergyFeeMode
}): Promise<TransferEnergyInfo> {
  const [resources, estimated, energyFeeSun] = await Promise.all([
    loadEnergyResources(input.accountId, input.network.id).catch(() => null),
    estimateTrc20Energy({
      from: input.from,
      to: input.to,
      contract: input.contract,
      amount: input.amount,
      networkScope: input.network.networkScope,
    }),
    getTronEnergyFeeSun(input.network.networkScope),
  ])
  const required = requiredEnergy(estimated, input.tokenGasLimit)
  const left = resources?.energyLeft ?? 0
  const short = left < required
  const quantity = rentQuantity(required, left)
  const burnSun = burnSunForEnergy(required, left, energyFeeSun)
  const burnTrx = sunToTrx(burnSun)
  let canRent = false
  let rentReason = ''
  let quote: TransferEnergyInfo['quote'] = null
  if (short && input.network.networkScope !== 'mainnet') {
    rentReason = '能量租赁仅波场主网可用，测试网请燃烧 TRX'
  } else if (short && !getBaseUrl()) {
    rentReason = '未配置目录站，无法租赁能量，请燃烧 TRX 或到设置填写 https://beeqd.com'
  } else if (short && quantity > 0) {
    try {
      const estimatedQuote = await estimateEnergyOrder(quantity, '1h')
      quote = { priceTrx: sunToTrx(estimatedQuote.priceSun), quantity: estimatedQuote.quantity }
      canRent = true
    } catch (err) {
      rentReason = `暂时无法租赁能量：${err instanceof Error ? err.message : String(err)}`
    }
  }
  const selected: TronEnergyFeeMode =
    input.preferredMode === 'rent' && canRent ? 'rent' : input.preferredMode === 'burn' ? 'burn' : canRent ? 'rent' : 'burn'
  let cheaper: TransferEnergyInfo['cheaper'] = null
  let saveTrx = ''
  if (quote && burnSun > 0n) {
    const rentSun = parseTrxToSun(quote.priceTrx)
    if (rentSun > 0n) {
      cheaper = compareEnergyFees(rentSun, burnSun)
      if (cheaper !== 'same') {
        saveTrx = sunToTrx(rentSun > burnSun ? rentSun - burnSun : burnSun - rentSun)
      }
    }
  }
  return { required, left, short, canRent, rentReason, selected, quote, burnTrx, saveTrx, cheaper }
}

function parseTrxToSun(trx: string): bigint {
  try {
    return parseDecimalToMinor(trx, 6)
  } catch {
    return 0n
  }
}

function energyFeeMinor(energy: TransferEnergyInfo | undefined, fallback: bigint): bigint {
  if (!energy?.short) return fallback
  try {
    if (energy.selected === 'rent' && energy.quote) return parseDecimalToMinor(energy.quote.priceTrx, 6)
    if (energy.burnTrx) return parseDecimalToMinor(energy.burnTrx, 6)
  } catch {
    return fallback
  }
  return fallback
}

function energyFeeText(energy: TransferEnergyInfo): string {
  const rent = energy.quote ? `${energy.quote.priceTrx} TRX / 约 15 秒–2 分钟` : '—'
  const burn = `${energy.burnTrx} TRX / 约 3 秒`
  if (energy.selected === 'rent' && energy.quote) {
    return energy.saveTrx
      ? `租赁 ${rent}（燃烧约 ${burn}，少付 ${energy.saveTrx} TRX）`
      : `租赁 ${rent}（燃烧约 ${burn}）`
  }
  return energy.quote ? `燃烧约 ${burn}（租赁 ${rent}）` : `燃烧约 ${burn}`
}

function buildPreview(input: {
  account: AccountRecord
  to: string
  token: TokenRecord
  amountMinor: bigint
  feeMinor: bigint
  feeText: string
  detail: Record<string, string>
  warnings: string[]
  energy?: TransferEnergyInfo
}): TransferPreview {
  return {
    draftId: newId(),
    from: input.account.address,
    to: input.to,
    amount: formatMinor(input.amountMinor, input.token.decimals),
    amountMinor: input.amountMinor.toString(),
    symbol: input.token.symbol,
    decimals: input.token.decimals,
    feeMinor: input.feeMinor.toString(),
    feeText: input.feeText,
    totalMinor: (input.amountMinor + (input.token.isToken ? 0n : input.feeMinor)).toString(),
    detail: input.detail,
    warnings: input.warnings,
    energy: input.energy,
  }
}

function resolveEvmFeeQuote(
  quotes: Record<'low' | 'medium' | 'high', EvmFeeQuote>,
  input: TransferDraftInput,
): EvmFeeQuote {
  const base = quotes[input.feeLevel === 'custom' ? 'medium' : input.feeLevel]
  if (input.feeLevel !== 'custom' || !input.customFeeRate) return base
  const gwei = Number(input.customFeeRate)
  if (!Number.isFinite(gwei) || gwei <= 0) throw invalidArg('自定义费率不合法')
  const wei = BigInt(Math.round(gwei * 1e9))
  let priority = base.maxPriorityFeePerGas
  if (input.customPriorityFee) {
    const tip = Number(input.customPriorityFee)
    if (!Number.isFinite(tip) || tip < 0) throw invalidArg('自定义优先费不合法')
    priority = BigInt(Math.round(tip * 1e9))
  }
  if (priority > wei) priority = wei
  return {
    eip1559: base.eip1559,
    maxFeePerGas: wei,
    maxPriorityFeePerGas: priority,
    gasPrice: base.eip1559 ? null : wei,
  }
}

interface SignedDraftRaw {
  txid: string
  raw: string
  rawFormat: TxLabSigned['rawFormat']
}

async function signStoredDraft(draft: StoredDraft): Promise<SignedDraftRaw> {
  const accountRow = requireAccountRow(draft.account.id)

  if (draft.network.walletType === 'bitcoin') {
    if (!draft.account.addressType || draft.feeRate == null) throw invalidArg('Bitcoin 预览数据不完整')
    const result = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
      buildAndSignBitcoinTx({
        networkScope: draft.network.networkScope,
        addressType: draft.account.addressType!,
        fromAddress: draft.account.address,
        toAddress: draft.to,
        publicKeyHex: draft.account.publicKey,
        privateKey,
        amountSats: draft.amountMinor,
        feeRate: draft.feeRate!,
        sendMax: draft.input.sendMax,
      }),
    )
    return { txid: bitcoinTxidFromHex(result.hex), raw: result.hex, rawFormat: 'hex' }
  }

  if (draft.network.walletType === 'web3') {
    const contract = contractOf(draft.token)
    const nonce = draft.input.nonce ?? (await getEvmNonce(draft.network, draft.account.address))
    const signed = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
      signAndSerializeEvmTx({
        privateKey,
        chainId: Number(draft.network.chainId),
        nonce,
        to: contract ?? draft.to,
        value: contract ? 0n : draft.amountMinor,
        data: draft.data,
        gasLimit: draft.gasLimit ?? 21000n,
        fee: draft.evmFee!,
      }),
    )
    return { txid: signed.hash, raw: signed.hex, rawFormat: 'hex' }
  }

  if (draft.network.walletType === 'solana') {
    const mint = contractOf(draft.token)
    const signed = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
      buildAndSignSolanaTx({
        network: draft.network,
        privateKey,
        from: draft.account.address,
        to: draft.to,
        mint,
        amount: draft.amountMinor,
      }),
    )
    return { txid: signed.signature, raw: signed.wireBase64, rawFormat: 'base64' }
  }

  const contract = contractOf(draft.token)
  const unsigned = contract
    ? await createTrc20Tx({
        from: draft.account.address,
        to: draft.to,
        contract,
        amount: draft.amountMinor,
        feeLimitSun: draft.feeLimitSun ?? 40_000_000n,
        networkScope: draft.network.networkScope,
      })
    : await createTronNativeTx({
        from: draft.account.address,
        to: draft.to,
        amountSun: draft.amountMinor,
        networkScope: draft.network.networkScope,
      })
  const signed = withAccountPrivateKey(accountRow, (privateKey) => signTronTx(unsigned, privateKey))
  return { txid: signed.txID, raw: JSON.stringify(signed), rawFormat: 'json' }
}

export async function signTransferDraft(draftId: string): Promise<TxLabSigned> {
  pruneDrafts()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('转账预览已过期，请重新预览')
  drafts.delete(draftId)
  const signed = await signStoredDraft(draft)
  const decoded = decodeRawTransaction(draft.network.walletType, signed.raw)
  return {
    walletType: draft.network.walletType,
    networkPk: draft.network.id,
    accountId: draft.account.id,
    from: draft.account.address,
    to: draft.to,
    amount: draft.preview.amount,
    symbol: draft.preview.symbol,
    feeText: draft.preview.feeText,
    raw: signed.raw,
    rawFormat: signed.rawFormat,
    txid: signed.txid || decoded.txid || '',
    signed: true,
    decoded: decoded.fields,
  }
}

export async function submitTransfer(draftId: string, energyFeeMode?: TronEnergyFeeMode): Promise<BroadcastResult> {
  pruneDrafts()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('转账预览已过期，请重新预览')
  drafts.delete(draftId)

  const mode = energyFeeMode ?? draft.energyFeeMode
  if (mode === 'rent' && contractOf(draft.token)) {
    const quantity = draft.energyQuantity ?? 0
    if (quantity <= 0) throw invalidArg('当前能量已足够，无需租赁')
    await rentEnergyAndWait({
      accountId: draft.account.id,
      networkPk: draft.network.id,
      quantity,
      duration: '1h',
    })
  }

  const signed = await signStoredDraft(draft)
  const txid = await broadcastRawOnNetwork(draft.network, signed.raw)
  return persistBroadcastedTx({
    network: draft.network,
    accountId: draft.account.id,
    from: draft.account.address,
    to: draft.to,
    tokenPk: draft.token.id,
    symbol: draft.token.symbol,
    amount: formatMinor(draft.amountMinor, draft.token.decimals),
    fee: formatMinor(draft.feeMinor, feeDecimalsOf(draft.network.walletType)),
    txid,
    raw: signed.raw,
  })
}

async function withAccountPrivateKeyAsync<T>(
  account: ReturnType<typeof requireAccountRow>,
  fn: (privateKey: Uint8Array) => Promise<T>,
): Promise<T> {
  return withAccountPrivateKey(account, (privateKey) => {
    const copy = Uint8Array.from(privateKey)
    return fn(copy).finally(() => copy.fill(0))
  })
}

export function receiveInfo(accountId: string): AccountRecord {
  return getAccount(accountId)
}

export function currentNetworkAccounts(networkPk: string): AccountRecord[] {
  const network = requireNetwork(networkPk)
  return listMatchingAccounts({
    walletType: network.walletType,
    networkScope: network.networkScope,
  }).map((row) => getAccount(row.id))
}

export { loadSettings }
