/**
 * 消息签名 / 验签。EVM 与 TRON 走 EIP-191 personal_sign，Bitcoin 走 BIP-137，Solana 走 Ed25519。
 */
import type {
  AccountRecord,
  SignMessageInput,
  SignMessageResult,
  VerifyMessageInput,
  VerifyMessageResult,
} from '@shared/types'
import { getAccountRow } from '../db/repos/accountRepo'
import { invalidArg, notFound } from '../ipc/registry'
import { getAccount, withAccountPrivateKey } from '../wallets/service'
import {
  hashPersonalMessageHex,
  personalSign,
  recoverPersonalSignAddress,
  verifyPersonalSign,
} from './evm'
import { bitcoinMessageHash, signBitcoinMessage, verifyBitcoinMessage } from './bitcoin'
import { signSolanaMessage, solanaMessageDigestHex, verifySolanaMessage } from './solana'
import { bytesToHex } from '@noble/hashes/utils'
import { isEvmAddress } from '../derive/evm'
import { isTronAddress, tronAddressFromEvmAddress, tronAddressToEvmAddress } from '../derive/tron'

export function signMessage(input: SignMessageInput): SignMessageResult {
  const message = input.message
  if (typeof message !== 'string' || message.length === 0) throw invalidArg('待签消息不能为空')
  const account = getAccount(input.accountId)
  const row = getAccountRow(input.accountId)
  if (!row) throw notFound('账户不存在')

  if (account.walletType === 'bitcoin') {
    if (!account.addressType) throw invalidArg('Bitcoin 账户缺少地址格式')
    return withAccountPrivateKey(row, (privateKey) => ({
      address: account.address,
      walletType: account.walletType,
      addressType: account.addressType,
      digest: `0x${bytesToHex(bitcoinMessageHash(message))}`,
      scheme: 'bip137',
      signature: signBitcoinMessage(privateKey, message, account.addressType!),
    }))
  }

  if (account.walletType === 'solana') {
    return withAccountPrivateKey(row, (privateKey) => ({
      address: account.address,
      walletType: account.walletType,
      addressType: null,
      digest: solanaMessageDigestHex(message),
      scheme: 'ed25519',
      signature: signSolanaMessage(privateKey, message),
    }))
  }

  return withAccountPrivateKey(row, (privateKey) => ({
    address: account.address,
    walletType: account.walletType,
    addressType: null,
    digest: hashPersonalMessageHex(message),
    scheme: 'eip191-personal_sign',
    signature: personalSign(privateKey, message),
  }))
}

export function verifyMessage(input: VerifyMessageInput): VerifyMessageResult {
  if (!input.message || !input.signature || !input.address) {
    throw invalidArg('验签需要地址、消息和签名')
  }
  if (input.walletType === 'bitcoin') {
    const networkScope = /^(tb1|bcrt1|[mn2])/i.test(input.address.trim()) ? 'testnet' : 'mainnet'
    return verifyBitcoinMessage(input.message, input.signature, input.address.trim(), networkScope)
  }
  if (input.walletType === 'tron') {
    if (!isTronAddress(input.address)) throw invalidArg('TRON 地址格式不合法')
    const evm = tronAddressToEvmAddress(input.address)
    const valid = verifyPersonalSign(input.message, input.signature, evm)
    const recoveredEvm = valid ? evm : safeRecover(input.message, input.signature)
    return {
      valid,
      recoveredAddress: recoveredEvm ? tronAddressFromEvmAddress(recoveredEvm) : null,
    }
  }
  if (input.walletType === 'solana') {
    return verifySolanaMessage(input.message, input.signature, input.address)
  }
  if (!isEvmAddress(input.address)) throw invalidArg('EVM 地址格式不合法')
  const recovered = safeRecover(input.message, input.signature)
  return {
    valid: recovered ? recovered.toLowerCase() === input.address.trim().toLowerCase() : false,
    recoveredAddress: recovered,
  }
}

function safeRecover(message: string, signature: string): string | null {
  try {
    return recoverPersonalSignAddress(message, signature)
  } catch {
    return null
  }
}

export type { AccountRecord }
