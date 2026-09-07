/**
 * 在当前 EVM 网络部署固定总量 ERC-20，并把合约写入本地代币目录。
 */
import type { IssuedTokenRecord, TokenIssueInput, TokenIssuePreview, TokenIssueResult } from '@shared/types'
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
import { watchTransaction } from '../history/watch'
import { encodeFixedErc20Deploy, normalizeIssueFields } from './encode'
import { finalizeIssuedTokenFromReceipt } from './pending'

interface StoredDraft {
  input: TokenIssueInput
  preview: TokenIssuePreview
  fields: ReturnType<typeof normalizeIssueFields>
  data: `0x${string}`
  gasLimit: bigint
  evmFee: EvmFeeQuote
  createdAt: number
}

const drafts = new Map<string, StoredDraft>()
const DRAFT_TTL_MS = 10 * 60 * 1000

function prune(): void {
  const now = Date.now()
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > DRAFT_TTL_MS) drafts.delete(id)
  }
}

function requireNetwork(id: string) {
  const network = getNetwork(id)
  if (!network) throw notFound('网络不存在')
  if (network.walletType !== 'web3') throw invalidArg('只能在 EVM 网络发行 ERC-20')
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

export async function submitTokenIssue(draftId: string): Promise<TokenIssueResult> {
  prune()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('发行预览已过期，请重新预览')
  drafts.delete(draftId)

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

function looksLikeIssuedToken(txid: string, tokenPk: string | null, toAddress: string): boolean {
  if (findTokenIssueByTxid(txid) || !tokenPk) return false
  const token = getToken(tokenPk)
  if (!token?.isToken || !token.contractAddress) return false
  if (token.tokenStandard && token.tokenStandard !== 'erc20') return false
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
