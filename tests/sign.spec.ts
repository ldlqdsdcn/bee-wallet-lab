import { describe, expect, it } from 'vitest'
import { hexToBytes } from '@noble/hashes/utils'
import { formatMinor, parseDecimalToMinor } from '../electron/main/util/amount'
import { personalSign, recoverPersonalSignAddress, verifyPersonalSign } from '../electron/main/sign/evm'
import { signBitcoinMessage, verifyBitcoinMessage } from '../electron/main/sign/bitcoin'
import { evmAddressFromPrivateKey } from '../electron/main/derive/evm'
import { bitcoinAddressFromPublicKey } from '../electron/main/derive/bitcoin'
import { secp256k1 } from '@noble/curves/secp256k1'

const PRIVATE_KEY = hexToBytes('1111111111111111111111111111111111111111111111111111111111111111')

describe('金额换算', () => {
  it('十进制与最小单位可往返', () => {
    expect(parseDecimalToMinor('1.23', 8)).toBe(123000000n)
    expect(formatMinor(123000000n, 8)).toBe('1.23')
    expect(parseDecimalToMinor('0.00000001', 8)).toBe(1n)
    expect(formatMinor(1n, 18)).toBe('0.000000000000000001')
  })

  it('拒绝超出精度的小数', () => {
    expect(() => parseDecimalToMinor('1.123', 2)).toThrow(/精度/)
  })
})

describe('消息签名', () => {
  it('EVM personal_sign 可恢复地址', () => {
    const address = evmAddressFromPrivateKey(PRIVATE_KEY)
    const signature = personalSign(PRIVATE_KEY, 'hello bee')
    expect(verifyPersonalSign('hello bee', signature, address)).toBe(true)
    expect(recoverPersonalSignAddress('hello bee', signature)).toBe(address)
    expect(verifyPersonalSign('other', signature, address)).toBe(false)
  })

  it('Bitcoin BIP-137 可恢复对应地址', () => {
    const publicKey = secp256k1.getPublicKey(PRIVATE_KEY, true)
    const address = bitcoinAddressFromPublicKey(publicKey, 'p2wpkh', 'mainnet')
    const signature = signBitcoinMessage(PRIVATE_KEY, 'hello bee', 'p2wpkh')
    const verified = verifyBitcoinMessage('hello bee', signature, address, 'mainnet', 'p2wpkh')
    expect(verified.valid).toBe(true)
    expect(verified.recoveredAddress).toBe(address)
  })
})
