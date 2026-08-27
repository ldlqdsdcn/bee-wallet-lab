import { describe, expect, it } from 'vitest'
import {
  parseBlockscoutTokenTransfers,
  parseBlockscoutTransactions,
  parseEtherscanTokentx,
  parseEtherscanTxlist,
  parseEsploraAddressTxs,
  parseSolanaSignatures,
  parseSolanaTransaction,
  parseTronGridTransactions,
  parseTronGridTrc20,
} from '../electron/main/history/parse'

const ME = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'

describe('交易历史解析', () => {
  it('Esplora 按 vin/vout 净额判断收支', () => {
    const rows = parseEsploraAddressTxs(
      [
        {
          txid: 'btc-send',
          fee: 200,
          status: { confirmed: true, block_height: 800000, block_time: 1_700_000_000 },
          vin: [{ prevout: { scriptpubkey_address: ME, value: 10000 } }],
          vout: [{ scriptpubkey_address: OTHER, value: 9800 }],
        },
        {
          txid: 'btc-recv',
          fee: 150,
          status: { confirmed: false },
          vin: [{ prevout: { scriptpubkey_address: OTHER, value: 5000 } }],
          vout: [{ scriptpubkey_address: ME, value: 5000 }],
        },
      ],
      ME,
      'BTC',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      txid: 'btc-send',
      direction: 'send',
      amountMinor: 9800n,
      status: 'confirmed',
      blockHeight: 800000,
    })
    expect(rows[1]).toMatchObject({
      txid: 'btc-recv',
      direction: 'receive',
      amountMinor: 5000n,
      status: 'pending',
    })
  })

  it('Etherscan txlist / tokentx', () => {
    const native = parseEtherscanTxlist(
      {
        status: '1',
        result: [
          {
            hash: '0xaaa',
            from: ME,
            to: OTHER,
            value: '1000000000000000000',
            isError: '0',
            gasUsed: '21000',
            gasPrice: '1000000000',
            blockNumber: '10',
            timeStamp: '1700000000',
          },
          {
            hash: '0xskip',
            from: ME,
            to: OTHER,
            value: '0',
            isError: '0',
          },
        ],
      },
      ME,
      'ETH',
      18,
    )
    expect(native).toHaveLength(1)
    expect(native[0]).toMatchObject({
      txid: '0xaaa',
      direction: 'send',
      amountMinor: 10n ** 18n,
      feeMinor: 21000n * 1000000000n,
      symbol: 'ETH',
    })

    const tokens = parseEtherscanTokentx(
      {
        result: [
          {
            hash: '0xbbb',
            from: OTHER,
            to: ME,
            value: '5000000',
            tokenSymbol: 'usdc',
            tokenDecimal: '6',
            contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            blockNumber: '11',
            timeStamp: '1700000001',
          },
        ],
      },
      ME,
    )
    expect(tokens[0]).toMatchObject({
      txid: '0xbbb',
      direction: 'receive',
      symbol: 'USDC',
      amountMinor: 5000000n,
      decimals: 6,
    })
  })

  it('Blockscout v2 transactions / token-transfers', () => {
    const native = parseBlockscoutTransactions(
      {
        items: [
          {
            hash: '0xccc',
            from: { hash: ME },
            to: { hash: OTHER },
            value: '2000000000000000000',
            status: 'ok',
            fee: { value: '42000' },
            timestamp: '2024-01-01T00:00:00.000Z',
            block_number: 12,
          },
        ],
      },
      ME,
      'ETH',
      18,
    )
    expect(native[0]).toMatchObject({
      txid: '0xccc',
      direction: 'send',
      amountMinor: 2n * 10n ** 18n,
      feeMinor: 42000n,
    })

    const tokens = parseBlockscoutTokenTransfers(
      {
        items: [
          {
            transaction_hash: '0xddd',
            from: { hash: OTHER },
            to: { hash: ME },
            token: { symbol: 'USDT', decimals: 6, address: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
            total: { value: '1000000' },
            timestamp: '2024-01-01T00:00:00.000Z',
            block_number: 13,
          },
        ],
      },
      ME,
    )
    expect(tokens[0]).toMatchObject({
      txid: '0xddd',
      direction: 'receive',
      symbol: 'USDT',
      amountMinor: 1000000n,
    })
  })

  it('TronGrid 原生转账与 TRC20', () => {
    const me = 'TFromAddress11111111111111111111111'
    const other = 'TToAddress2222222222222222222222222'
    const native = parseTronGridTransactions(
      {
        data: [
          {
            txID: 'tron-1',
            blockNumber: 99,
            raw_data: {
              timestamp: 1_700_000_000_000,
              contract: [
                {
                  type: 'TransferContract',
                  parameter: {
                    value: { owner_address: me, to_address: other, amount: 1_000_000 },
                  },
                },
              ],
            },
            ret: [{ contractRet: 'SUCCESS' }],
          },
        ],
      },
      me,
      'TRX',
    )
    expect(native[0]).toMatchObject({
      txid: 'tron-1',
      direction: 'send',
      amountMinor: 1_000_000n,
      symbol: 'TRX',
    })

    const trc20 = parseTronGridTrc20(
      {
        data: [
          {
            transaction_id: 'tron-2',
            from: other,
            to: me,
            value: '2500000',
            block_timestamp: 1_700_000_100_000,
            token_info: { symbol: 'USDT', decimals: 6, address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' },
          },
        ],
      },
      me,
    )
    expect(trc20[0]).toMatchObject({
      txid: 'tron-2',
      direction: 'receive',
      symbol: 'USDT',
      amountMinor: 2500000n,
    })
  })

  it('Solana signatures 与余额变动', () => {
    const me = 'So11111111111111111111111111111111111111112'
    const other = 'So22222222222222222222222222222222222222223'
    expect(
      parseSolanaSignatures([
        { signature: 'sig-1', slot: 10, err: null, blockTime: 1700000000 },
        { signature: 'sig-2', slot: 11, err: { InstructionError: [0, 'Custom'] }, blockTime: 1700000001 },
      ]),
    ).toEqual([
      { signature: 'sig-1', slot: 10, err: false, blockTime: 1700000000 },
      { signature: 'sig-2', slot: 11, err: true, blockTime: 1700000001 },
    ])

    const send = parseSolanaTransaction(
      {
        transaction: { message: { accountKeys: [me, other] } },
        meta: { preBalances: [2_000_000_000, 0], postBalances: [900_000_000, 1_095_000_000], fee: 5000 },
      },
      me,
      'sig-1',
      { slot: 10, err: false, blockTime: 1700000000 },
    )
    expect(send[0]).toMatchObject({
      txid: 'sig-1',
      direction: 'send',
      symbol: 'SOL',
      amountMinor: 1_099_995_000n,
      feeMinor: 5000n,
    })
  })
})
