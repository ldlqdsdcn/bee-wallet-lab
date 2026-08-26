/**
 * 转账：预览（构建未签名意图）与提交（本地签名并直连节点广播）。
 */
import type {
  AccountRecord,
  BroadcastResult,
  FeeLevel,
  NetworkRecord,
  TokenRecord,
  TransferDraftInput,
  TransferPreview,
  TransactionRecord,
} from '@shared/types'
import { newId } from '../security/crypto'
import { parseDecimalToMinor, formatMinor } from '../util/amount'
import { getNetwork, getToken } from '../db/repos/catalogRepo'
import { getAccountRow, listMatchingAccounts } from '../db/repos/accountRepo'
import { insertTransaction, listTransactions } from '../db/repos/transactionRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import {
  broadcastBitcoinTx,
  buildAndSignBitcoinTx,
  explorerUrlForBitcoin,
  estimateVsize,
  fetchFeeRates,
  fetchUtxos,
} from '../chain/bitcoin'
import {
  broadcastEvmTx,
  encodeErc20Transfer,
  estimateEvmGas,
  explorerUrlForEvm,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
  type EvmFeeQuote,
} from '../chain/evm'
import {
  broadcastTronTx,
  createTrc20Tx,
  createTronNativeTx,
  estimateTronNativeFeeSun,
  explorerUrlForTron,
  getTronAccount,
  signTronTx,
} from '../chain/tron'
import { isBitcoinAddress } from '../derive/bitcoin'
import { isEvmAddress, toChecksumAddress } from '../derive/evm'
import { isTronAddress } from '../derive/tron'
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
    const quote = quotes[input.feeLevel === 'custom' ? 'medium' : input.feeLevel]
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

  const contract = contractOf(token)
  const recipient = await getTronAccount(to, network.networkScope)
  const feeLimitSun = input.feeLimit ? parseDecimalToMinor(input.feeLimit, 6) : 40_000_000n
  const feeMinor = contract ? feeLimitSun : estimateTronNativeFeeSun(recipient.active)
  const preview = buildPreview({
    account,
    to,
    token,
    amountMinor,
    feeMinor,
    feeText: contract
      ? `feeLimit ${formatMinor(feeLimitSun, 6)} TRX`
      : `${formatMinor(feeMinor, 6)} TRX`,
    detail: {
      recipientActive: String(recipient.active),
      contract: contract ?? '',
      feeLimitSun: feeLimitSun.toString(),
    },
    warnings: recipient.active ? [] : ['收款地址尚未激活，转账将额外消耗约 1.1 TRX'],
  })
  drafts.set(preview.draftId, {
    input,
    preview,
    network,
    token,
    account,
    amountMinor,
    feeMinor,
    feeLimitSun,
    to,
    createdAt: Date.now(),
  })
  return preview
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
  }
}

export async function submitTransfer(draftId: string): Promise<BroadcastResult> {
  pruneDrafts()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('转账预览已过期，请重新预览')
  drafts.delete(draftId)

  const accountRow = requireAccountRow(draft.account.id)
  let txid = ''
  let rawHex: string | null = null

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
    rawHex = result.hex
    txid = await broadcastBitcoinTx(result.hex, draft.network.networkScope)
  } else if (draft.network.walletType === 'web3') {
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
    rawHex = signed.hex
    txid = await broadcastEvmTx(draft.network, signed.hex)
  } else {
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
    txid = await broadcastTronTx(signed, draft.network.networkScope)
    rawHex = JSON.stringify(signed)
  }

  const explorerUrl =
    draft.network.walletType === 'bitcoin'
      ? explorerUrlForBitcoin(txid, draft.network.networkScope, draft.network.browser)
      : draft.network.walletType === 'web3'
        ? explorerUrlForEvm(txid, draft.network.browser)
        : explorerUrlForTron(txid, draft.network.networkScope, draft.network.browser)

  insertTransaction({
    id: newId(),
    networkPk: draft.network.id,
    accountId: draft.account.id,
    txid,
    direction: 'send',
    fromAddress: draft.account.address,
    toAddress: draft.to,
    tokenPk: draft.token.id,
    symbol: draft.token.symbol,
    amount: formatMinor(draft.amountMinor, draft.token.decimals),
    fee: formatMinor(draft.feeMinor, draft.network.walletType === 'bitcoin' ? 8 : draft.network.walletType === 'tron' ? 6 : 18),
    status: 'pending',
    blockHeight: null,
    rawHex,
    createdAt: Date.now(),
    explorerUrl,
  })

  return { txid, explorerUrl, reportedToBackend: false }
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

export function listLocalTransactions(accountId?: string): TransactionRecord[] {
  return listTransactions(accountId)
}

export function currentNetworkAccounts(networkPk: string): AccountRecord[] {
  const network = requireNetwork(networkPk)
  return listMatchingAccounts({
    walletType: network.walletType,
    networkScope: network.networkScope,
  }).map((row) => getAccount(row.id))
}

export { loadSettings }
