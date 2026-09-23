import { describe, expect, it } from 'vitest'
import {
  parseBlockscoutTokenTransfers,
  parseBlockscoutTransactions,
  parseEtherscanTokentx,
  parseEtherscanTxlist,
  parseEsploraAddressTxs,
  parseSolanaSignatures,
  parseSolanaTransaction,
  parseTronGridInternal,
  parseTronGridTransactions,
  parseTronGridTrc20,
} from '../electron/main/history/parse'
import { parseRpcNativeTxs, parseRpcTransferLog } from '../electron/main/history/evmNode'
import {
  addressFromTopic,
  buildAccountTxQuery,
  ERC20_TRANSFER_TOPIC,
  filterHistoryFromBlock,
  historyBlockWindow,
  isDeprecatedV1,
  nativeScanFrom,
  topicAddress,
} from '../electron/main/history/range'

const ME = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'

describe('交易同步范围', () => {
  it('首次同步只拉最近一页，不带 startblock', () => {
    expect(buildAccountTxQuery({ action: 'txlist', address: ME, startBlock: null })).toBe(
      `module=account&action=txlist&address=${ME}&page=1&offset=50&sort=desc`,
    )
  })

  it('已有记录时从最后区块往后拉', () => {
    expect(
      buildAccountTxQuery({ action: 'txlist', address: ME, startBlock: 38000000, chainId: '8453' }),
    ).toBe(
      `chainid=8453&module=account&action=txlist&address=${ME}&startblock=38000000&endblock=99999999&page=1&offset=100&sort=asc`,
    )
  })

  it('丢掉低于已同步区块的记录，未上链的仍保留', () => {
    const rows = filterHistoryFromBlock(
      [
        { txid: 'old', direction: 'send', fromAddress: ME, toAddress: OTHER, amountMinor: 1n, decimals: 18, symbol: 'ETH', contractAddress: null, feeMinor: null, status: 'confirmed', blockHeight: 10, timestampMs: 1 },
        { txid: 'new', direction: 'send', fromAddress: ME, toAddress: OTHER, amountMinor: 1n, decimals: 18, symbol: 'ETH', contractAddress: null, feeMinor: null, status: 'confirmed', blockHeight: 20, timestampMs: 2 },
        { txid: 'pend', direction: 'send', fromAddress: ME, toAddress: OTHER, amountMinor: 1n, decimals: 18, symbol: 'ETH', contractAddress: null, feeMinor: null, status: 'pending', blockHeight: null, timestampMs: 3 },
      ],
      20,
    )
    expect(rows.map((item) => item.txid)).toEqual(['new', 'pend'])
  })

  it('节点扫描窗口从最后区块往后，首次只扫最近一段', () => {
    expect(historyBlockWindow(40_000, null, 8_000, 2_000)).toEqual({ from: 38_000, to: 40_000 })
    expect(historyBlockWindow(40_000, 39_500, 8_000)).toEqual({ from: 39_500, to: 40_000 })
    expect(historyBlockWindow(40_000, 10_000, 8_000)).toEqual({ from: 32_000, to: 40_000 })
    expect(nativeScanFrom(32_000, 40_000, 400)).toBe(39_601)
  })

  it('识别 Basescan V1 已停用', () => {
    expect(
      isDeprecatedV1({
        status: '0',
        message: 'NOTOK',
        result: 'You are using a deprecated V1 endpoint, switch to Etherscan API V2',
      }),
    ).toBe(true)
  })
})

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

  it('节点 Transfer 日志与原生交易', () => {
    expect(topicAddress(ME)).toBe(`0x${'0'.repeat(24)}${ME.slice(2).toLowerCase()}`)
    expect(addressFromTopic(topicAddress(ME))).toBe(ME.toLowerCase())
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const token = parseRpcTransferLog(
      {
        address: usdc,
        topics: [ERC20_TRANSFER_TOPIC, topicAddress(OTHER), topicAddress(ME)],
        data: '0x' + (5000000n).toString(16).padStart(64, '0'),
        transactionHash: '0xeee',
        blockNumber: '0xb',
        logIndex: '0x1',
      },
      ME,
      [{ contractAddress: usdc, symbol: 'USDC', decimals: 6 } as never],
      1_700_000_000_000,
    )
    expect(token).toMatchObject({
      txid: '0xeee',
      direction: 'receive',
      symbol: 'USDC',
      amountMinor: 5000000n,
      blockHeight: 11,
    })

    const native = parseRpcNativeTxs(
      {
        number: '0xc',
        timestamp: '0x6550a9c0',
        transactions: [
          { hash: '0xfff', from: ME, to: OTHER, value: '0xde0b6b3a7640000' },
          { hash: '0xskip', from: ME, to: OTHER, value: '0x0' },
        ],
      },
      ME,
      'ETH',
      18,
    )
    expect(native).toHaveLength(1)
    expect(native[0]).toMatchObject({
      txid: '0xfff',
      direction: 'send',
      amountMinor: 10n ** 18n,
      symbol: 'ETH',
      blockHeight: 12,
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

    const internal = parseTronGridInternal(
      {
        data: [
          {
            tx_id: 'swap-1',
            from_address: '414ab38f7ae7eadad03981b2a7d7883760aa63e564',
            to_address: '418de4ce26894f8d71bba88dc36f3fa58d647eac39',
            block_timestamp: 1_700_000_200_000,
            data: { note: 'call', rejected: false, call_value: { _: 5_890_443 } },
          },
          {
            tx_id: 'swap-fail',
            from_address: '414ab38f7ae7eadad03981b2a7d7883760aa63e564',
            to_address: '418de4ce26894f8d71bba88dc36f3fa58d647eac39',
            data: { note: 'call', rejected: true, call_value: { _: 6_000_000 } },
          },
        ],
      },
      'TNuUNmyrDYfAGHcnApYV3xMF1AjfggbZzc',
      'TRX',
    )
    expect(internal).toHaveLength(1)
    expect(internal[0]).toMatchObject({
      txid: 'swap-1',
      direction: 'receive',
      symbol: 'TRX',
      amountMinor: 5_890_443n,
      toAddress: 'TNuUNmyrDYfAGHcnApYV3xMF1AjfggbZzc',
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
