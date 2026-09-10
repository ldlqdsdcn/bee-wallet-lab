import { describe, expect, it } from 'vitest'
import { hexToBytes } from '@noble/hashes/utils'
import { secp256k1 } from '@noble/curves/secp256k1'
import * as btc from '@scure/btc-signer'
import { base58 } from '@scure/base'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import { signAndSerializeEvmTx } from '../electron/main/chain/evm'
import { decodeRawTransaction, normalizeBroadcastRaw } from '../electron/main/txLab/decode'

const PRIVATE_KEY = hexToBytes('1111111111111111111111111111111111111111111111111111111111111111')

describe('交易实验室 IPC', () => {
  it('只签名 / 解码 / 广播通道已加入白名单', () => {
    expect(IPC.txLabSign).toBe('txLab:sign')
    expect(IPC.txLabDecode).toBe('txLab:decode')
    expect(IPC.txLabBroadcast).toBe('txLab:broadcast')
    expect(IPC_CHANNELS).toContain(IPC.txLabSign)
    expect(IPC_CHANNELS).toContain(IPC.txLabDecode)
    expect(IPC_CHANNELS).toContain(IPC.txLabBroadcast)
  })
})

describe('原始交易解码', () => {
  it('解析已签名的 EVM 交易并算出 hash', async () => {
    const signed = await signAndSerializeEvmTx({
      privateKey: PRIVATE_KEY,
      chainId: 1,
      nonce: 7,
      to: '0x1111111111111111111111111111111111111111',
      value: 1n,
      gasLimit: 21000n,
      fee: {
        eip1559: true,
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        gasPrice: null,
      },
    })
    const decoded = decodeRawTransaction('web3', signed.hex)
    expect(decoded.signed).toBe(true)
    expect(decoded.rawFormat).toBe('hex')
    expect(decoded.txid).toBe(signed.hash)
    expect(decoded.fields.to.toLowerCase()).toBe('0x1111111111111111111111111111111111111111')
    expect(decoded.fields.nonce).toBe('7')
    expect(decoded.fields.value).toBe('1')
    expect(decoded.fields.chainId).toBe('1')
  })

  it('解析已签名的 Bitcoin 交易', () => {
    const publicKey = secp256k1.getPublicKey(PRIVATE_KEY, true)
    const payment = btc.p2wpkh(publicKey, btc.NETWORK)
    const tx = new btc.Transaction()
    tx.addInput({
      txid: new Uint8Array(32),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 100_000n },
    })
    tx.addOutputAddress(payment.address!, 90_000n, btc.NETWORK)
    tx.sign(PRIVATE_KEY)
    tx.finalize()

    const decoded = decodeRawTransaction('bitcoin', tx.hex)
    expect(decoded.signed).toBe(true)
    expect(decoded.rawFormat).toBe('hex')
    expect(decoded.txid).toBe(tx.id)
    expect(decoded.fields.inputs).toBe('1')
    expect(decoded.fields.outputs).toBe('1')
    expect(decoded.fields.outputAmounts).toBe('90000')
  })

  it('解析 TRON JSON 并识别签名', () => {
    const unsigned = {
      txID: 'aa'.repeat(32),
      raw_data: {
        contract: [
          {
            type: 'TransferContract',
            parameter: {
              value: {
                amount: 1_000_000,
                owner_address: 'TFromxxxxxxxxxxxxxxxxxxxxxxxxxxx',
                to_address: 'TToxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              },
            },
          },
        ],
        fee_limit: 40_000_000,
      },
    }
    const noSig = decodeRawTransaction('tron', JSON.stringify(unsigned))
    expect(noSig.signed).toBe(false)
    expect(noSig.txid).toBe('aa'.repeat(32))
    expect(noSig.fields.from).toContain('TFrom')
    expect(noSig.warnings.some((item) => item.includes('尚未签名'))).toBe(true)

    const signed = decodeRawTransaction('tron', JSON.stringify({ ...unsigned, signature: ['bb'.repeat(65)] }))
    expect(signed.signed).toBe(true)
    expect(signed.fields.signatures).toBe('1')
    expect(signed.warnings).toEqual([])
  })

  it('解析 Solana legacy wire 并取出第一签名', () => {
    const signature = new Uint8Array(64)
    signature[0] = 9
    const payer = new Uint8Array(32)
    payer[31] = 1
    const dest = new Uint8Array(32)
    dest[31] = 2
    const blockhash = new Uint8Array(32)
    blockhash[31] = 3
    const header = Uint8Array.of(1, 0, 1)
    const accounts = concatBytes(compactU16(2), payer, dest)
    const data = concatBytes(u32le(2), u64le(1_000n))
    const ix = concatBytes(Uint8Array.of(0), compactU16(2), Uint8Array.of(0, 1), compactU16(data.length), data)
    const message = concatBytes(header, accounts, blockhash, compactU16(1), ix)
    const wire = concatBytes(compactU16(1), signature, message)
    const raw = Buffer.from(wire).toString('base64')

    const decoded = decodeRawTransaction('solana', raw)
    expect(decoded.signed).toBe(true)
    expect(decoded.rawFormat).toBe('base64')
    expect(decoded.txid).toBe(base58.encode(signature))
    expect(decoded.fields.feePayer).toBe(base58.encode(payer))
    expect(decoded.fields.instructions).toBe('1')
    expect(decoded.fields.recentBlockhash).toBe(base58.encode(blockhash))
  })
})

describe('广播原始交易规范化', () => {
  it('EVM 补 0x，Bitcoin 去掉 0x，Solana Hex 转 Base64', () => {
    expect(normalizeBroadcastRaw('web3', 'aabb')).toBe('0xaabb')
    expect(normalizeBroadcastRaw('web3', '0xaabb')).toBe('0xaabb')
    expect(normalizeBroadcastRaw('bitcoin', '0xdead')).toBe('dead')
    expect(normalizeBroadcastRaw('solana', '0011223344556677')).toBe(
      Buffer.from('0011223344556677', 'hex').toString('base64'),
    )
    expect(normalizeBroadcastRaw('solana', 'AQID')).toBe('AQID')
  })
})

function compactU16(n: number): Uint8Array {
  const out: number[] = []
  let remaining = n
  for (;;) {
    const elem = remaining & 0x7f
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

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
