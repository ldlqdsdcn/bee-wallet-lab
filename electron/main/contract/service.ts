/**
 * 合约交互：EVM eth_call / 写交易，TRON triggerconstant / triggersmartcontract。
 */
import type {
  AccountRecord,
  ContractReadInput,
  ContractReadResult,
  ContractSigned,
  ContractWriteInput,
  ContractWritePreview,
  FeeLevel,
  NetworkRecord,
} from '@shared/types'
import { newId } from '../security/crypto'
import { formatMinor, parseDecimalToMinor } from '../util/amount'
import { getNetwork } from '../db/repos/catalogRepo'
import { getAccountRow } from '../db/repos/accountRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import { abiCalldataToTronParameter, decodeAbiReturn, encodeAbiCall, isReadFunction, parseAbiDocument } from '../abi/codec'
import {
  callEvmContract,
  estimateEvmGas,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
  type EvmFeeQuote,
} from '../chain/evm'
import { callTronContract, createTronContractTx, signTronTx } from '../chain/tron'
import { normalizeContractAddress as normalizeAddress } from './address'

interface StoredDraft {
  input: ContractWriteInput
  preview: ContractWritePreview
  network: NetworkRecord
  account: AccountRecord
  contract: string
  calldata: `0x${string}`
  valueMinor: bigint
  evmFee?: EvmFeeQuote
  gasLimit?: bigint
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

function requireAccount(id: string): AccountRecord {
  return getAccount(id)
}

function requireAccountRow(id: string) {
  const row = getAccountRow(id)
  if (!row) throw notFound('付款账户不存在')
  return row
}

function nativeDecimals(network: NetworkRecord): number {
  return network.walletType === 'tron' ? 6 : 18
}

function nativeSymbol(network: NetworkRecord): string {
  return network.coinEasy || (network.walletType === 'tron' ? 'TRX' : 'ETH')
}

function normalizeContractAddress(network: NetworkRecord, address: string): string {
  try {
    return normalizeAddress(network.walletType, address)
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : String(err))
  }
}

function requireContractNetwork(network: NetworkRecord): void {
  if (network.walletType !== 'web3' && network.walletType !== 'tron') {
    throw invalidArg('当前网络不支持合约交互，请切换到 EVM 或 TRON')
  }
}

function parseValue(network: NetworkRecord, value?: string): bigint {
  const text = (value ?? '').trim()
  if (!text) return 0n
  try {
    const minor = parseDecimalToMinor(text, nativeDecimals(network))
    if (minor < 0n) throw invalidArg('转账金额不能为负')
    return minor
  } catch (err) {
    if (err instanceof Error && /不合法|精度|负/.test(err.message)) throw invalidArg(err.message)
    throw invalidArg('原生币金额不合法')
  }
}

function resolveEvmFeeQuote(
  quotes: Record<'low' | 'medium' | 'high', EvmFeeQuote>,
  input: ContractWriteInput,
): EvmFeeQuote {
  const level: FeeLevel = input.feeLevel ?? 'medium'
  const base = quotes[level === 'custom' ? 'medium' : level]
  if (level !== 'custom' || !input.customFeeRate) return base
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

function encodeCall(input: { abiJson: string; signature: string; args: string[] }) {
  try {
    return encodeAbiCall(input.abiJson, input.signature, input.args ?? [])
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : String(err))
  }
}

function requireFunction(abiJson: string, signature: string) {
  const parsed = parseAbiDocument(abiJson)
  const fn = parsed.functions.find((item) => item.signature === signature || item.name === signature)
  if (!fn) throw invalidArg(`ABI 中没有函数 ${signature}`)
  return fn
}

export async function readContract(input: ContractReadInput): Promise<ContractReadResult> {
  const network = requireNetwork(input.networkPk)
  requireContractNetwork(network)
  const contract = normalizeContractAddress(network, input.contractAddress)
  const fn = requireFunction(input.abiJson, input.signature)
  if (!isReadFunction(fn.stateMutability)) {
    throw invalidArg(`${fn.signature} 不是 view / pure，请用写入`)
  }
  const encoded = encodeCall({ abiJson: input.abiJson, signature: fn.signature, args: input.args })
  const account = input.accountId ? requireAccount(input.accountId) : null
  if (account && account.walletType !== network.walletType) {
    throw invalidArg('调用账户与所选网络不匹配')
  }

  let raw = '0x'
  if (network.walletType === 'web3') {
    raw = await callEvmContract({
      network,
      from: account?.address,
      to: contract,
      data: encoded.calldata as `0x${string}`,
    })
  } else {
    const from = account?.address ?? contract
    const hex = await callTronContract({
      from,
      contract,
      selector: fn.signature,
      parameter: abiCalldataToTronParameter(encoded.calldata),
      networkScope: network.networkScope,
    })
    raw = hex ? (hex.startsWith('0x') ? hex : `0x${hex}`) : '0x'
  }

  if (fn.outputs.length > 0 && (!raw || raw === '0x')) {
    throw invalidArg('合约没有返回数据')
  }
  if (fn.outputs.length === 0) {
    return { signature: fn.signature, raw, values: [] }
  }
  try {
    const decoded = decodeAbiReturn(input.abiJson, fn.signature, raw)
    return { signature: fn.signature, raw, values: decoded.values }
  } catch (err) {
    throw invalidArg(err instanceof Error ? err.message : String(err))
  }
}

export async function previewContractWrite(input: ContractWriteInput): Promise<ContractWritePreview> {
  pruneDrafts()
  const network = requireNetwork(input.networkPk)
  requireContractNetwork(network)
  const account = requireAccount(input.accountId)
  if (account.walletType !== network.walletType) throw invalidArg('付款账户与所选网络不匹配')
  const contract = normalizeContractAddress(network, input.contractAddress)
  const fn = requireFunction(input.abiJson, input.signature)
  if (isReadFunction(fn.stateMutability)) {
    throw invalidArg(`${fn.signature} 是只读方法，请用读取`)
  }
  const encoded = encodeCall({ abiJson: input.abiJson, signature: fn.signature, args: input.args })
  const valueMinor = parseValue(network, input.value)
  if (valueMinor > 0n && fn.stateMutability !== 'payable') {
    throw invalidArg(`${fn.signature} 不是 payable，不能附带原生币`)
  }
  const warnings: string[] = []
  if (fn.stateMutability === 'payable' && valueMinor === 0n) {
    warnings.push('这是 payable 方法，当前没有附带原生币')
  }

  if (network.walletType === 'web3') {
    const quotes = await quoteEvmFees(network)
    const quote = resolveEvmFeeQuote(quotes, input)
    const gasLimit = input.gasLimit
      ? BigInt(input.gasLimit)
      : await estimateEvmGas({
          network,
          from: account.address,
          to: contract,
          value: valueMinor,
          data: encoded.calldata as `0x${string}`,
        })
    const feeMinor = (quote.maxFeePerGas || quote.gasPrice || 0n) * gasLimit
    const preview: ContractWritePreview = {
      draftId: newId(),
      from: account.address,
      contractAddress: contract,
      signature: fn.signature,
      calldata: encoded.calldata,
      value: formatMinor(valueMinor, 18),
      feeText: `${formatMinor(feeMinor, 18)} ${nativeSymbol(network)}`,
      detail: {
        chainId: network.chainId,
        gasLimit: gasLimit.toString(),
        maxFeePerGas: quote.maxFeePerGas.toString(),
        eip1559: String(quote.eip1559),
        selector: encoded.selector,
      },
      warnings,
    }
    drafts.set(preview.draftId, {
      input,
      preview,
      network,
      account,
      contract,
      calldata: encoded.calldata as `0x${string}`,
      valueMinor,
      evmFee: quote,
      gasLimit,
      createdAt: Date.now(),
    })
    return preview
  }

  let feeLimitSun = 40_000_000n
  if (input.feeLimit) {
    try {
      feeLimitSun = parseDecimalToMinor(input.feeLimit, 6)
    } catch (err) {
      throw invalidArg(err instanceof Error ? err.message : 'feeLimit 不合法')
    }
  }
  const preview: ContractWritePreview = {
    draftId: newId(),
    from: account.address,
    contractAddress: contract,
    signature: fn.signature,
    calldata: encoded.calldata,
    value: formatMinor(valueMinor, 6),
    feeText: `feeLimit ${formatMinor(feeLimitSun, 6)} TRX`,
    detail: {
      selector: encoded.selector,
      feeLimitSun: feeLimitSun.toString(),
      parameter: abiCalldataToTronParameter(encoded.calldata),
    },
    warnings,
  }
  drafts.set(preview.draftId, {
    input,
    preview,
    network,
    account,
    contract,
    calldata: encoded.calldata as `0x${string}`,
    valueMinor,
    feeLimitSun,
    createdAt: Date.now(),
  })
  return preview
}

export async function signContractWrite(draftId: string): Promise<ContractSigned> {
  pruneDrafts()
  const draft = drafts.get(draftId)
  if (!draft) throw invalidArg('合约预览已过期，请重新预览')
  drafts.delete(draftId)
  const accountRow = requireAccountRow(draft.account.id)

  if (draft.network.walletType === 'web3') {
    const nonce = draft.input.nonce ?? (await getEvmNonce(draft.network, draft.account.address))
    const signed = await withAccountPrivateKeyAsync(accountRow, (privateKey) =>
      signAndSerializeEvmTx({
        privateKey,
        chainId: Number(draft.network.chainId),
        nonce,
        to: draft.contract,
        value: draft.valueMinor,
        data: draft.calldata,
        gasLimit: draft.gasLimit ?? 100000n,
        fee: draft.evmFee!,
      }),
    )
    return {
      walletType: 'web3',
      networkPk: draft.network.id,
      accountId: draft.account.id,
      from: draft.account.address,
      contractAddress: draft.contract,
      signature: draft.preview.signature,
      calldata: draft.calldata,
      value: draft.preview.value,
      feeText: draft.preview.feeText,
      raw: signed.hex,
      rawFormat: 'hex',
      txid: signed.hash,
    }
  }

  const unsigned = await createTronContractTx({
    from: draft.account.address,
    contract: draft.contract,
    selector: draft.preview.signature,
    parameter: abiCalldataToTronParameter(draft.calldata),
    feeLimitSun: draft.feeLimitSun ?? 40_000_000n,
    callValueSun: draft.valueMinor,
    networkScope: draft.network.networkScope,
  })
  const signed = withAccountPrivateKey(accountRow, (privateKey) => signTronTx(unsigned, privateKey))
  return {
    walletType: 'tron',
    networkPk: draft.network.id,
    accountId: draft.account.id,
    from: draft.account.address,
    contractAddress: draft.contract,
    signature: draft.preview.signature,
    calldata: draft.calldata,
    value: draft.preview.value,
    feeText: draft.preview.feeText,
    raw: JSON.stringify(signed),
    rawFormat: 'json',
    txid: signed.txID,
  }
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
