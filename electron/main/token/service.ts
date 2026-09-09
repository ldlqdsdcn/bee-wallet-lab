/**
 * 发行固定总量代币：EVM 上部署 ERC-20，Solana 上创建 SPL mint。
 */
import type { IssuedTokenRecord, NetworkRecord, TokenIssueInput, TokenIssuePreview, TokenIssueResult } from '@shared/types'
import { IPC_EVENT } from '../../../shared/ipc'
import { newId } from '../security/crypto'
import { formatMinor } from '../util/amount'
import { getNetwork, getToken } from '../db/repos/catalogRepo'
import { getAccountRow } from '../db/repos/accountRepo'
import { listTransactions, upsertTransaction } from '../db/repos/transactionRepo'
import {
  findTokenIssueByTxid,
  insertTokenIssue,
  listTokenIssues,
} from '../db/repos/tokenIssueRepo'
import { broadcast, invalidArg, notFound } from '../ipc/registry'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import {
  estimateEvmGas,
  explorerUrlForEvm,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
  broadcastEvmTx,
  waitForEvmReceipt,
  type EvmFeeQuote,
} from '../chain/evm'
import {
  broadcastSolanaTx,
  buildAndSignSolanaIssueTx,
  explorerUrlForSolana,
  quoteSolanaIssueFee,
  waitForSolanaConfirmation,
} from '../chain/solana'
import { watchTransaction } from '../history/watch'
import { encodeFixedErc20Deploy, normalizeIssueFields } from './encode'
import { finalizeIssuedTokenFromReceipt, finalizeIssuedSolanaToken, rememberIssuedTokenIcon } from './pending'
import { createMintKeypair, normalizeSolanaIssueFields, normalizeSolanaMetadata } from './solanaIssue'

interface EvmDraft {
  kind: 'evm'
  input: TokenIssueInput
  preview: TokenIssuePreview
  fields: ReturnType<typeof normalizeIssueFields>
  data: `0x${string}`
  gasLimit: bigint
  evmFee: EvmFeeQuote
  createdAt: number
}

interface SolanaDraft {
  kind: 'solana'
  input: TokenIssueInput
  preview: TokenIssuePreview
  fields: ReturnType<typeof normalizeIssueFields>
  metadata: ReturnType<typeof normalizeSolanaMetadata>
  mintSecret: Uint8Array
  mintAddress: string
  createdAt: number
}

type StoredDraft = EvmDraft | SolanaDraft

const drafts = new Map<string, StoredDraft>()
const DRAFT_TTL_MS = 10 * 60 * 1000

function wipeDraft(draft: StoredDraft): void {
  if (draft.kind === 'solana') draft.mintSecret.fill(0)
}

function prune(): void {
  const now = Date.now()
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) {
      wipeDraft(draft)
      drafts.delete(id)
    }
  }
}

function requireNetwork(id: string): NetworkRecord {
  const network = getNetwork(id)
  if (!network) throw notFound('网络不存在')
  if (network.walletType !== 'web3' && network.walletType !== 'solana') {
    throw invalidArg('只能在 EVM 或 Solana 网络发行代币')
  }
  return network
}

function requireAccountRow(id: string) {
  const row = getAccountRow(id)
  if (!row) throw notFound('付款账户不存在')
  return row
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

export async function previewTokenIssue(input: TokenIssueInput): Promise<TokenIssuePreview> {
  prune()
  const network = requireNetwork(input.networkPk)
  if (network.walletType === 'solana') return previewSolanaIssue(network, input)
  return previewEvmIssue(network, input)
}

async function previewEvmIssue(network: NetworkRecord, input: TokenIssueInput): Promise<TokenIssuePreview> {
  const account = getAccount(input.accountId)
  if (account.walletType !== 'web3') throw invalidArg('请选择 EVM 账户')
  const fields = normalizeIssueFields(input)
  const data = encodeFixedErc20Deploy(fields)
  const quotes = await quoteEvmFees(network)
  const evmFee = quotes.medium
  const gasLimit = await estimateEvmGas({
    network,
    from: account.address,
    value: 0n,
    data,
  })
  const feeMinor = (evmFee.maxFeePerGas || evmFee.gasPrice || 0n) * gasLimit
  const warnings: string[] = []
  if (network.networkScope === 'mainnet') {
    warnings.push('当前是主网，部署会消耗真实 Gas。')
  }
  warnings.push('总量在合约里一次铸给当前账户，之后不能再增发。')
  const preview: TokenIssuePreview = {
    draftId: newId(),
    from: account.address,
    name: fields.name,
    symbol: fields.symbol,
    decimals: fields.decimals,
    supply: fields.supply,
    supplyMinor: fields.supplyMinor.toString(),
    feeText: `${formatMinor(feeMinor, 18)} ${network.coinEasy ?? 'ETH'}`,
    feeMinor: feeMinor.toString(),
    warnings,
  }
  drafts.set(preview.draftId, {
    kind: 'evm',
    input,
    preview,
    fields,
    data,
    gasLimit,
    evmFee,
    createdAt: Date.now(),
  })
  return preview
}

async function previewSolanaIssue(network: NetworkRecord, input: TokenIssueInput): Promise<TokenIssuePreview> {
  const account = getAccount(input.accountId)
  if (account.walletType !== 'solana') throw invalidArg('请选择 Solana 账户')
  const fields = normalizeSolanaIssueFields(input)
  const metadata = normalizeSolanaMetadata({
    name: fields.name,
    symbol: fields.symbol,
    description: input.description,
    logoUrl: input.logoUrl,
    website: input.website,
    metadataUri: input.metadataUri,
  })
  const mint = createMintKeypair()
  const feeMinor = await quoteSolanaIssueFee(network)
  const warnings: string[] = []
  if (network.networkScope === 'mainnet') {
    warnings.push('当前是 Solana 主网，会消耗真实 SOL（含 mint / ATA / 元数据租金）。')
  }
  warnings.push('总量一次铸给当前账户，随后关掉增发权限。名称和符号写入 Metaplex。')
  if (metadata.metadataUri) {
    warnings.push('链上元数据 URI 会指向你托管的 JSON，钱包和浏览器才能显示 logo、官网。')
  } else if (metadata.logoUrl || metadata.website || metadata.description) {
    warnings.push('已生成元数据 JSON。请把它传到可公开访问的 https 地址，把链接填进「元数据 URI」再预览一次，否则链上只有名称符号，logo/官网只留在本机。')
  } else {
    warnings.push('未填 logo/官网。可以只发名称符号；若要钱包显示图标，请补 logo 和元数据 URI。')
  }
  warnings.push(`Mint 地址预览：${mint.address}`)
  const preview: TokenIssuePreview = {
    draftId: newId(),
    from: account.address,
    name: fields.name,
    symbol: fields.symbol,
    decimals: fields.decimals,
    supply: fields.supply,
    supplyMinor: fields.supplyMinor.toString(),
    feeText: `${formatMinor(feeMinor, 9)} ${network.coinEasy ?? 'SOL'}`,
    feeMinor: feeMinor.toString(),
    warnings,
    contractAddress: mint.address,
    logoUrl: metadata.logoUrl || null,
    website: metadata.website || null,
    metadataUri: metadata.metadataUri || null,
    metadataJson: metadata.metadataJson,
  }
  drafts.set(preview.draftId, {
    kind: 'solana',
    input,
    preview,
    fields,
    metadata,
    mintSecret: mint.secret,
    mintAddress: mint.address,
    createdAt: Date.now(),
  })
  return preview
}

export async function submitTokenIssue(draftId: string): Promise<TokenIssueResult> {
  prune()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('发行预览已过期，请重新预览')
  drafts.delete(draftId)
  try {
    if (draft.kind === 'solana') return await submitSolanaIssue(draft)
    return await submitEvmIssue(draft)
  } finally {
    wipeDraft(draft)
  }
}

async function submitEvmIssue(draft: EvmDraft): Promise<TokenIssueResult> {
  const network = requireNetwork(draft.input.networkPk)
  const account = getAccount(draft.input.accountId)
  const accountRow = requireAccountRow(draft.input.accountId)

  const nonce = await getEvmNonce(network, account.address)
  const signed = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
    signAndSerializeEvmTx({
      privateKey,
      chainId: Number(network.chainId),
      nonce,
      to: null,
      value: 0n,
      data: draft.data,
      gasLimit: draft.gasLimit,
      fee: draft.evmFee,
    }),
  )
  const txid = await broadcastEvmTx(network, signed.hex)
  const explorerUrl = explorerUrlForEvm(txid, network.browser, network.chainId)
  const transaction = upsertTransaction({
    id: newId(),
    networkPk: network.id,
    accountId: account.id,
    txid,
    direction: 'send',
    fromAddress: account.address,
    toAddress: account.address,
    tokenPk: null,
    symbol: draft.fields.symbol,
    amount: draft.fields.supply,
    fee: formatMinor(BigInt(draft.preview.feeMinor), 18),
    status: 'pending',
    blockHeight: null,
    rawHex: signed.hex,
    createdAt: Date.now(),
    explorerUrl,
  })
  const issue = insertTokenIssue({
    id: newId(),
    networkPk: network.id,
    accountId: account.id,
    tokenPk: null,
    transactionId: transaction.id,
    fromAddress: account.address,
    name: draft.fields.name,
    symbol: draft.fields.symbol,
    decimals: draft.fields.decimals,
    supply: draft.fields.supply,
    supplyMinor: draft.fields.supplyMinor.toString(),
    contractAddress: null,
    txid,
    explorerUrl,
    status: 'pending',
  })
  watchTransaction(transaction)
  broadcast(IPC_EVENT.catalogUpdated, { kind: 'issue' })
  broadcast(IPC_EVENT.transactionUpdated, { record: transaction, issue })

  void waitForEvmReceipt(network, txid)
    .then((receipt) => {
      if (receipt) finalizeIssuedTokenFromReceipt(txid, receipt)
    })
    .catch((err) => {
      console.warn('[token-issue] 等待回执失败', err instanceof Error ? err.message : err)
    })

  return { txid, explorerUrl, contractAddress: null, token: null, transaction, issue }
}

async function submitSolanaIssue(draft: SolanaDraft): Promise<TokenIssueResult> {
  const network = requireNetwork(draft.input.networkPk)
  if (network.walletType !== 'solana') throw invalidArg('预览与当前网络不一致')
  const account = getAccount(draft.input.accountId)
  if (account.walletType !== 'solana') throw invalidArg('请选择 Solana 账户')
  const accountRow = requireAccountRow(draft.input.accountId)

  const signed = await withAccountPrivateKeyAsync(accountRow, async (privateKey) => {
    try {
      return await buildAndSignSolanaIssueTx({
        network,
        payerKey: privateKey,
        mintKey: draft.mintSecret,
        payer: account.address,
        mint: draft.mintAddress,
        decimals: draft.fields.decimals,
        amount: draft.fields.supplyMinor,
        name: draft.fields.name,
        symbol: draft.fields.symbol,
        uri: draft.metadata.metadataUri,
        withMetadata: true,
      })
    } catch (err) {
      console.warn('[token-issue] 带元数据签名失败，改为不写 Metaplex', err instanceof Error ? err.message : err)
      return buildAndSignSolanaIssueTx({
        network,
        payerKey: privateKey,
        mintKey: draft.mintSecret,
        payer: account.address,
        mint: draft.mintAddress,
        decimals: draft.fields.decimals,
        amount: draft.fields.supplyMinor,
        name: draft.fields.name,
        symbol: draft.fields.symbol,
        uri: draft.metadata.metadataUri,
        withMetadata: false,
      })
    }
  })

  let txid: string
  try {
    txid = await broadcastSolanaTx(network, signed.wireBase64)
  } catch (err) {
    const signedPlain = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
      buildAndSignSolanaIssueTx({
        network,
        payerKey: privateKey,
        mintKey: draft.mintSecret,
        payer: account.address,
        mint: draft.mintAddress,
        decimals: draft.fields.decimals,
        amount: draft.fields.supplyMinor,
        name: draft.fields.name,
        symbol: draft.fields.symbol,
        uri: draft.metadata.metadataUri,
        withMetadata: false,
      }),
    )
    try {
      txid = await broadcastSolanaTx(network, signedPlain.wireBase64)
    } catch {
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  const explorerUrl = explorerUrlForSolana(txid, network)
  const transaction = upsertTransaction({
    id: newId(),
    networkPk: network.id,
    accountId: account.id,
    txid,
    direction: 'send',
    fromAddress: account.address,
    toAddress: draft.mintAddress,
    tokenPk: null,
    symbol: draft.fields.symbol,
    amount: draft.fields.supply,
    fee: formatMinor(BigInt(draft.preview.feeMinor), 9),
    status: 'pending',
    blockHeight: null,
    rawHex: signed.wireBase64,
    createdAt: Date.now(),
    explorerUrl,
  })
  if (draft.metadata.logoUrl) rememberIssuedTokenIcon(draft.mintAddress, draft.metadata.logoUrl)
  const issue = insertTokenIssue({
    id: newId(),
    networkPk: network.id,
    accountId: account.id,
    tokenPk: null,
    transactionId: transaction.id,
    fromAddress: account.address,
    name: draft.fields.name,
    symbol: draft.fields.symbol,
    decimals: draft.fields.decimals,
    supply: draft.fields.supply,
    supplyMinor: draft.fields.supplyMinor.toString(),
    contractAddress: draft.mintAddress,
    txid,
    explorerUrl,
    status: 'pending',
  })
  watchTransaction(transaction)
  broadcast(IPC_EVENT.catalogUpdated, { kind: 'issue' })
  broadcast(IPC_EVENT.transactionUpdated, { record: transaction, issue, contractAddress: draft.mintAddress })

  void waitForSolanaConfirmation(network, txid)
    .then((status) => {
      if (status) finalizeIssuedSolanaToken(txid, status)
    })
    .catch((err) => {
      console.warn('[token-issue] 等待 Solana 确认失败', err instanceof Error ? err.message : err)
    })

  return {
    txid,
    explorerUrl,
    contractAddress: draft.mintAddress,
    token: null,
    transaction,
    issue,
  }
}

function looksLikeIssuedToken(txid: string, tokenPk: string | null, toAddress: string): boolean {
  if (findTokenIssueByTxid(txid) || !tokenPk) return false
  const token = getToken(tokenPk)
  if (!token?.isToken || !token.contractAddress) return false
  const standard = (token.tokenStandard ?? '').toLowerCase()
  if (standard && standard !== 'erc20' && standard !== 'spl') return false
  return token.contractAddress.toLowerCase() === toAddress.toLowerCase()
}

function backfillIssuedTokens(networkPk?: string): void {
  for (const tx of listTransactions(networkPk ? { networkPk } : {})) {
    if (!looksLikeIssuedToken(tx.txid, tx.tokenPk, tx.toAddress)) continue
    const token = getToken(tx.tokenPk as string)
    if (!token) continue
    try {
      insertTokenIssue({
        id: newId(),
        networkPk: tx.networkPk,
        accountId: tx.accountId,
        tokenPk: token.id,
        transactionId: tx.id,
        fromAddress: tx.fromAddress,
        name: token.name ?? token.symbol,
        symbol: token.symbol,
        decimals: token.decimals,
        supply: tx.amount,
        supplyMinor: '0',
        contractAddress: token.contractAddress,
        txid: tx.txid,
        explorerUrl: tx.explorerUrl,
        status: tx.status === 'failed' ? 'failed' : tx.status === 'pending' ? 'pending' : 'confirmed',
        createdAt: tx.createdAt,
      })
    } catch {
      /* 并发列表或重复回填时 txid 已存在 */
    }
  }
}

export function listIssuedTokens(networkPk?: string): IssuedTokenRecord[] {
  backfillIssuedTokens(networkPk)
  return listTokenIssues(networkPk)
}
