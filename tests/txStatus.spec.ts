import { describe, expect, it } from 'vitest'
import {
  parseEvmReceipt,
  parseEsploraTx,
  parseSolanaSignatureStatus,
  parseTronTxInfo,
} from '../electron/main/history/status'

describe('交易确认解析', () => {
  it('EVM receipt 0x1 为确认，0x0 为失败，空为等待', () => {
    expect(parseEvmReceipt(null)).toEqual({ status: 'pending', blockHeight: null })
    expect(parseEvmReceipt({ status: '0x1', blockNumber: '0xa' })).toEqual({
      status: 'confirmed',
      blockHeight: 10,
    })
    expect(parseEvmReceipt({ status: '0x0', blockNumber: '0x12' })).toEqual({
      status: 'failed',
      blockHeight: 18,
    })
  })

  it('Esplora status.confirmed', () => {
    expect(parseEsploraTx({ status: { confirmed: false } })).toEqual({
      status: 'pending',
      blockHeight: null,
    })
    expect(parseEsploraTx({ status: { confirmed: true, block_height: 800000 } })).toEqual({
      status: 'confirmed',
      blockHeight: 800000,
    })
  })

  it('TRON gettransactioninfobyid', () => {
    expect(parseTronTxInfo({})).toEqual({ status: 'pending', blockHeight: null })
    expect(parseTronTxInfo({ id: 'aa', blockNumber: 99, receipt: { result: 'SUCCESS' } })).toEqual({
      status: 'confirmed',
      blockHeight: 99,
    })
    expect(parseTronTxInfo({ id: 'aa', blockNumber: 99, receipt: { result: 'FAILED' } })).toEqual({
      status: 'failed',
      blockHeight: 99,
    })
  })

  it('Solana signature status', () => {
    expect(parseSolanaSignatureStatus(null)).toEqual({ status: 'pending', blockHeight: null })
    expect(parseSolanaSignatureStatus({ confirmationStatus: 'processed', slot: 1 })).toEqual({
      status: 'pending',
      blockHeight: 1,
    })
    expect(parseSolanaSignatureStatus({ confirmationStatus: 'finalized', slot: 8, err: null })).toEqual({
      status: 'confirmed',
      blockHeight: 8,
    })
    expect(parseSolanaSignatureStatus({ confirmationStatus: 'confirmed', slot: 8, err: { InstructionError: [] } })).toEqual({
      status: 'failed',
      blockHeight: 8,
    })
  })
})
