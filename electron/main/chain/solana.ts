/**
 * Solana JSON-RPC：余额、原生 SOL / SPL 转账、广播。
 */
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'
import { base58 } from '@scure/base'
import type { NetworkRecord, NetworkScope } from '@shared/types'
import { isSolanaAddress, solanaPublicKey } from '../derive/solana'
import { networkByType, rpcUrlsForNetwork, tryRpcUrls } from '../rpc/nodes'
import { resolveSolanaRpcUrl } from '../rpc/endpoints'
import { setPreferredRpc } from '../rpc/preference'
import { providerPost } from '../rpc/fetch'

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
const SYSVAR_RENT = 'SysvarRent111111111111111111111111111111111'
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress')
const SIGNATURE_FEE_LAMPORTS = 5_000n
const ATA_RENT_LAMPORTS = 2_039_280n
const MINT_ACCOUNT_SIZE = 82
const METADATA_ACCOUNT_SIZE = 679

interface JsonRpcResponse<T> {
  result?: T
  error?: { message?: string }
}

interface TokenAccountInfo {
  pubkey: string
  amount: bigint
  decimals: number
}

function pk(value: string): Uint8Array {
  return base58.decode(value)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function compactU16(n: number): Uint8Array {
  const out: number[] = []
  let remaining = n
  for (;;) {
    let elem = remaining & 0x7f
    remaining >>= 7
    if (remaining === 0) {
      out.push(elem)
      break
    }
    out.push(elem | 0x80)
  }
  return Uint8Array.from(out)
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, value, true)
  return out
}

function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes)
    return true
  } catch {
    return false
  }
}

function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): Uint8Array {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = sha256(concat([...seeds, Uint8Array.of(bump), programId, PDA_MARKER]))
    if (!isOnCurve(hash)) return hash
  }
  throw new Error('无法计算 Associated Token Account')
}

export function metadataAddress(mint: string): string {
  return base58.encode(
    findProgramAddress(
      [new TextEncoder().encode('metadata'), pk(METADATA_PROGRAM), pk(mint)],
      pk(METADATA_PROGRAM),
    ),
  )
}

export function associatedTokenAddress(owner: string, mint: string): string {
  return base58.encode(
    findProgramAddress([pk(owner), pk(TOKEN_PROGRAM), pk(mint)], pk(ASSOCIATED_TOKEN_PROGRAM)),
  )
}

export function solanaRpcCandidates(network: NetworkRecord): string[] {
  return rpcUrlsForNetwork(network)
}

export function solanaApiCandidates(scope: NetworkScope): string[] {
  const network = networkByType('solana', scope)
  if (network) return rpcUrlsForNetwork(network)
  return [resolveSolanaRpcUrl(scope)]
}

async function solanaRpc<T>(network: NetworkRecord, method: string, params: unknown[] = []): Promise<T> {
  const { url, result } = await tryRpcUrls(solanaRpcCandidates(network), async (base) => {
    const body = await providerPost<JsonRpcResponse<T>>(base, { jsonrpc: '2.0', id: Date.now(), method, params })
    if (body?.error) throw new Error(body.error.message || `RPC ${method} 失败`)
    return body.result as T
  })
  setPreferredRpc(network.id, url)
  return result
}

export async function getSolBalance(network: NetworkRecord, address: string): Promise<bigint> {
  const payload = await solanaRpc<{ value: number }>(network, 'getBalance', [address])
  return BigInt(payload?.value ?? 0)
}

export async function getSplBalance(network: NetworkRecord, owner: string, mint: string): Promise<bigint> {
  const accounts = await listTokenAccounts(network, owner, mint)
  return accounts.reduce((sum, item) => sum + item.amount, 0n)
}

async function listTokenAccounts(
  network: NetworkRecord,
  owner: string,
  mint: string,
): Promise<TokenAccountInfo[]> {
  const payload = await solanaRpc<{ value: Array<Record<string, unknown>> }>(network, 'getTokenAccountsByOwner', [
    owner,
    { mint },
    { encoding: 'jsonParsed' },
  ])
  return (payload?.value ?? []).map((item) => {
    const parsed = (((item.account as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined)
      ?.parsed as Record<string, unknown> | undefined)?.info as Record<string, unknown> | undefined
    const tokenAmount = (parsed?.tokenAmount ?? {}) as Record<string, unknown>
    return {
      pubkey: String(item.pubkey ?? ''),
      amount: BigInt(String(tokenAmount.amount ?? '0')),
      decimals: Number(tokenAmount.decimals ?? 0),
    }
  })
}

async function getRecentBlockhash(network: NetworkRecord): Promise<string> {
  const payload = await solanaRpc<{ value: { blockhash: string } }>(network, 'getLatestBlockhash', [
    { commitment: 'confirmed' },
  ])
  const hash = payload?.value?.blockhash
  if (!hash) throw new Error('节点未返回 recent blockhash')
  return hash
}

async function accountExists(network: NetworkRecord, address: string): Promise<boolean> {
  const info = await solanaRpc<unknown>(network, 'getAccountInfo', [address, { encoding: 'base64' }])
  return info != null
}

export async function quoteSolanaFee(
  network: NetworkRecord,
  to: string,
  mint: string | null,
): Promise<{ feeLamports: bigint; createAta: boolean }> {
  if (!mint) return { feeLamports: SIGNATURE_FEE_LAMPORTS, createAta: false }
  const destAta = associatedTokenAddress(to, mint)
  const createAta = !(await accountExists(network, destAta))
  return { feeLamports: SIGNATURE_FEE_LAMPORTS + (createAta ? ATA_RENT_LAMPORTS : 0n), createAta }
}

interface AccountMeta {
  address: string
  signer: boolean
  writable: boolean
}

interface CompiledIx {
  programId: string
  accounts: AccountMeta[]
  data: Uint8Array
}

function compileMessage(input: {
  payer: string
  blockhash: string
  instructions: CompiledIx[]
}): Uint8Array {
  const metas = new Map<string, AccountMeta>()
  const touch = (meta: AccountMeta) => {
    const prev = metas.get(meta.address)
    if (!prev) {
      metas.set(meta.address, { ...meta })
      return
    }
    prev.signer = prev.signer || meta.signer
    prev.writable = prev.writable || meta.writable
  }

  touch({ address: input.payer, signer: true, writable: true })
  for (const ix of input.instructions) {
    touch({ address: ix.programId, signer: false, writable: false })
    for (const account of ix.accounts) touch(account)
  }

  const all = [...metas.values()]
  const signedWritable = all.filter((item) => item.signer && item.writable)
  const signedReadonly = all.filter((item) => item.signer && !item.writable)
  const unsignedWritable = all.filter((item) => !item.signer && item.writable)
  const unsignedReadonly = all.filter((item) => !item.signer && !item.writable)
  const ordered = [...signedWritable, ...signedReadonly, ...unsignedWritable, ...unsignedReadonly]
  const indexOf = (address: string) => {
    const index = ordered.findIndex((item) => item.address === address)
    if (index < 0) throw new Error(`交易缺少账户 ${address}`)
    return index
  }

  const header = Uint8Array.of(
    signedWritable.length + signedReadonly.length,
    signedReadonly.length,
    unsignedReadonly.length,
  )
  const accountKeys = concat([compactU16(ordered.length), ...ordered.map((item) => pk(item.address))])
  const compiled = input.instructions.map((ix) => {
    const accounts = Uint8Array.from(ix.accounts.map((item) => indexOf(item.address)))
    return concat([
      Uint8Array.of(indexOf(ix.programId)),
      compactU16(accounts.length),
      accounts,
      compactU16(ix.data.length),
      ix.data,
    ])
  })
  return concat([header, accountKeys, pk(input.blockhash), compactU16(compiled.length), ...compiled])
}

function signLegacyTx(message: Uint8Array, ...privateKeys: Uint8Array[]): Uint8Array {
  const signatures = privateKeys.map((key) => ed25519.sign(message, key))
  return concat([compactU16(signatures.length), ...signatures, message])
}

function coptionNone(): Uint8Array {
  return new Uint8Array(4)
}

function borshString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value)
  return concat([u32le(bytes.length), bytes])
}

export function encodeSystemCreateAccount(lamports: bigint, space: number, owner: string): Uint8Array {
  return concat([u32le(0), u64le(lamports), u64le(BigInt(space)), pk(owner)])
}

export function encodeInitializeMint2(decimals: number, mintAuthority: string): Uint8Array {
  return concat([Uint8Array.of(20, decimals), pk(mintAuthority), coptionNone()])
}

export function encodeMintTo(amount: bigint): Uint8Array {
  return concat([Uint8Array.of(7), u64le(amount)])
}

export function encodeSetMintAuthorityNone(): Uint8Array {
  return concat([Uint8Array.of(6, 0), coptionNone()])
}

export function encodeCreateMetadataV3(name: string, symbol: string, uri = '', mutable = true): Uint8Array {
  return concat([
    Uint8Array.of(33),
    borshString(name),
    borshString(symbol),
    borshString(uri),
    new Uint8Array(2),
    Uint8Array.of(0, 0, 0, mutable ? 1 : 0, 0),
  ])
}

function systemTransferIx(from: string, to: string, lamports: bigint): CompiledIx {
  return {
    programId: SYSTEM_PROGRAM,
    accounts: [
      { address: from, signer: true, writable: true },
      { address: to, signer: false, writable: true },
    ],
    data: concat([u32le(2), u64le(lamports)]),
  }
}

function systemCreateAccountIx(from: string, newAccount: string, lamports: bigint, space: number, owner: string): CompiledIx {
  return {
    programId: SYSTEM_PROGRAM,
    accounts: [
      { address: from, signer: true, writable: true },
      { address: newAccount, signer: true, writable: true },
    ],
    data: encodeSystemCreateAccount(lamports, space, owner),
  }
}

function initializeMint2Ix(mint: string, decimals: number, mintAuthority: string): CompiledIx {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [{ address: mint, signer: false, writable: true }],
    data: encodeInitializeMint2(decimals, mintAuthority),
  }
}

function mintToIx(mint: string, dest: string, authority: string, amount: bigint): CompiledIx {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [
      { address: mint, signer: false, writable: true },
      { address: dest, signer: false, writable: true },
      { address: authority, signer: true, writable: false },
    ],
    data: encodeMintTo(amount),
  }
}

function setMintAuthorityNoneIx(mint: string, currentAuthority: string): CompiledIx {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [
      { address: mint, signer: false, writable: true },
      { address: currentAuthority, signer: true, writable: false },
    ],
    data: encodeSetMintAuthorityNone(),
  }
}

function createMetadataV3Ix(
  mint: string,
  payer: string,
  name: string,
  symbol: string,
  uri: string,
): CompiledIx {
  const metadata = metadataAddress(mint)
  return {
    programId: METADATA_PROGRAM,
    accounts: [
      { address: metadata, signer: false, writable: true },
      { address: mint, signer: false, writable: false },
      { address: payer, signer: true, writable: false },
      { address: payer, signer: true, writable: true },
      { address: payer, signer: false, writable: false },
      { address: SYSTEM_PROGRAM, signer: false, writable: false },
    ],
    data: encodeCreateMetadataV3(name, symbol, uri, true),
  }
}

function createAtaIx(payer: string, owner: string, mint: string, ata: string): CompiledIx {
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM,
    accounts: [
      { address: payer, signer: true, writable: true },
      { address: ata, signer: false, writable: true },
      { address: owner, signer: false, writable: false },
      { address: mint, signer: false, writable: false },
      { address: SYSTEM_PROGRAM, signer: false, writable: false },
      { address: TOKEN_PROGRAM, signer: false, writable: false },
      { address: SYSVAR_RENT, signer: false, writable: false },
    ],
    data: Uint8Array.of(1),
  }
}

function splTransferIx(source: string, dest: string, owner: string, amount: bigint): CompiledIx {
  return {
    programId: TOKEN_PROGRAM,
    accounts: [
      { address: source, signer: false, writable: true },
      { address: dest, signer: false, writable: true },
      { address: owner, signer: true, writable: false },
    ],
    data: concat([Uint8Array.of(3), u64le(amount)]),
  }
}

export async function buildAndSignSolanaTx(input: {
  network: NetworkRecord
  privateKey: Uint8Array
  from: string
  to: string
  mint: string | null
  amount: bigint
}): Promise<{ signature: string; wireBase64: string; feeLamports: bigint }> {
  if (!isSolanaAddress(input.to)) throw new Error('收款地址不是有效的 Solana 地址')
  const fromPk = base58.encode(solanaPublicKey(input.privateKey))
  if (fromPk !== input.from) throw new Error('付款私钥与账户地址不匹配')

  const blockhash = await getRecentBlockhash(input.network)
  const instructions: CompiledIx[] = []
  let feeLamports = SIGNATURE_FEE_LAMPORTS

  if (!input.mint) {
    instructions.push(systemTransferIx(input.from, input.to, input.amount))
  } else {
    const sources = await listTokenAccounts(input.network, input.from, input.mint)
    const source = sources.find((item) => item.amount >= input.amount)
    if (!source) throw new Error('该 SPL 代币余额不足')
    const destAta = associatedTokenAddress(input.to, input.mint)
    if (!(await accountExists(input.network, destAta))) {
      instructions.push(createAtaIx(input.from, input.to, input.mint, destAta))
      feeLamports += ATA_RENT_LAMPORTS
    }
    instructions.push(splTransferIx(source.pubkey, destAta, input.from, input.amount))
  }

  const message = compileMessage({ payer: input.from, blockhash, instructions })
  const wire = signLegacyTx(message, input.privateKey)
  const signature = base58.encode(wire.slice(1, 65))
  const wireBase64 = Buffer.from(wire).toString('base64')
  return { signature, wireBase64, feeLamports }
}

async function getRentExempt(network: NetworkRecord, space: number): Promise<bigint> {
  const value = await solanaRpc<number>(network, 'getMinimumBalanceForRentExemption', [space])
  return BigInt(value ?? 0)
}

export async function quoteSolanaIssueFee(network: NetworkRecord): Promise<bigint> {
  const mintRent = await getRentExempt(network, MINT_ACCOUNT_SIZE)
  const ataRent = await getRentExempt(network, 165)
  const metadataRent = await getRentExempt(network, METADATA_ACCOUNT_SIZE)
  return SIGNATURE_FEE_LAMPORTS * 2n + mintRent + ataRent + metadataRent
}

export async function buildAndSignSolanaIssueTx(input: {
  network: NetworkRecord
  payerKey: Uint8Array
  mintKey: Uint8Array
  payer: string
  mint: string
  decimals: number
  amount: bigint
  name: string
  symbol: string
  uri?: string
  withMetadata?: boolean
}): Promise<{ signature: string; wireBase64: string; feeLamports: bigint }> {
  const fromPk = base58.encode(solanaPublicKey(input.payerKey))
  if (fromPk !== input.payer) throw new Error('付款私钥与账户地址不匹配')
  const mintPk = base58.encode(solanaPublicKey(input.mintKey))
  if (mintPk !== input.mint) throw new Error('mint 私钥与地址不匹配')

  const mintRent = await getRentExempt(input.network, MINT_ACCOUNT_SIZE)
  const ataRent = await getRentExempt(input.network, 165)
  const metadataRent = input.withMetadata === false ? 0n : await getRentExempt(input.network, METADATA_ACCOUNT_SIZE)
  const ata = associatedTokenAddress(input.payer, input.mint)
  const blockhash = await getRecentBlockhash(input.network)
  const instructions: CompiledIx[] = [
    systemCreateAccountIx(input.payer, input.mint, mintRent, MINT_ACCOUNT_SIZE, TOKEN_PROGRAM),
    initializeMint2Ix(input.mint, input.decimals, input.payer),
    createAtaIx(input.payer, input.payer, input.mint, ata),
    mintToIx(input.mint, ata, input.payer, input.amount),
  ]
  if (input.withMetadata !== false) {
    instructions.push(createMetadataV3Ix(input.mint, input.payer, input.name, input.symbol, input.uri ?? ''))
  }
  instructions.push(setMintAuthorityNoneIx(input.mint, input.payer))

  const message = compileMessage({ payer: input.payer, blockhash, instructions })
  const wire = signLegacyTx(message, input.payerKey, input.mintKey)
  return {
    signature: base58.encode(wire.slice(1, 65)),
    wireBase64: Buffer.from(wire).toString('base64'),
    feeLamports: SIGNATURE_FEE_LAMPORTS * 2n + mintRent + ataRent + metadataRent,
  }
}

export async function waitForSolanaConfirmation(
  network: NetworkRecord,
  signature: string,
  timeoutMs = 45_000,
): Promise<unknown | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const status = await fetchSolanaSignatureStatus(network, signature)
    if (status) {
      const row = status as { err?: unknown; confirmationStatus?: string }
      if (row.err != null) return status
      const confirmation = String(row.confirmationStatus ?? '').toLowerCase()
      if (confirmation === 'confirmed' || confirmation === 'finalized') return status
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return null
}

export async function broadcastSolanaTx(network: NetworkRecord, wireBase64: string): Promise<string> {
  const signature = await solanaRpc<string>(network, 'sendTransaction', [
    wireBase64,
    { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
  ])
  if (!signature) throw new Error('节点未返回交易签名')
  return signature
}

export function explorerUrlForSolana(signature: string, network: NetworkRecord): string {
  const base = (network.browser ?? 'https://solscan.io').replace(/\?.*$/, '').replace(/\/+$/, '')
  const cluster = network.networkScope === 'testnet' ? '?cluster=devnet' : ''
  return `${base}/tx/${signature}${cluster}`
}

export async function fetchSolanaSignatures(network: NetworkRecord, address: string, limit = 30): Promise<unknown> {
  return solanaRpc<unknown>(network, 'getSignaturesForAddress', [address, { limit }])
}

export async function fetchSolanaSignatureStatus(network: NetworkRecord, signature: string): Promise<unknown> {
  const payload = await solanaRpc<{ value?: unknown[] }>(network, 'getSignatureStatuses', [
    [signature],
    { searchTransactionHistory: true },
  ])
  return payload?.value?.[0] ?? null
}

export async function fetchSolanaTransaction(network: NetworkRecord, signature: string): Promise<unknown> {
  return solanaRpc<unknown>(network, 'getTransaction', [
    signature,
    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
  ])
}
