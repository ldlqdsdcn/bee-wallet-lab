import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import {
  BTC_NATIVE_PLACEHOLDER,
  BRIDGE_API_PREFIX,
  BRIDGE_CHAIN_IDS,
  bridgeChainIdOf,
  bridgeFamilyOf,
  involvesBtc,
  originHashForBackend,
  parseBridgeFeeText,
  parseBridgeNetworkFeeText,
  formatGasLimitFee,
  parseBridgeHistoryRow,
  parseBridgeStatus,
  parseEstimatedSeconds,
  parseExecutableQuote,
  parsePriceResponse,
  parseQuoteIndex,
  parseSortQuotesBy,
  resolveBridgeHistoryStatus,
  tokenAddressForBridge,
} from '../electron/main/bridge/codec'
import { EVM_NATIVE_PLACEHOLDER, TRON_NATIVE_PLACEHOLDER } from '../electron/main/swap/codec'

describe('跨链桥 IPC', () => {
  it('通道已加入白名单', () => {
    expect(IPC.bridgeQuote).toBe('bridge:quote')
    expect(IPC.bridgeSubmit).toBe('bridge:submit')
    expect(IPC.bridgeStatus).toBe('bridge:status')
    expect(IPC.bridgeList).toBe('bridge:list')
    expect(IPC_CHANNELS).toContain(IPC.bridgeQuote)
    expect(IPC_CHANNELS).toContain(IPC.bridgeSubmit)
    expect(IPC_CHANNELS).toContain(IPC.bridgeStatus)
    expect(IPC_CHANNELS).toContain(IPC.bridgeList)
  })
})

describe('跨链桥 codec', () => {
  it('只开放 BTC 主网 / ETH / BSC / Arbitrum / 波场主网', () => {
    expect(bridgeChainIdOf({ walletType: 'bitcoin', networkScope: 'mainnet', chainId: '' })).toBe(0)
    expect(bridgeChainIdOf({ walletType: 'bitcoin', networkScope: 'testnet', chainId: '' })).toBeNull()
    expect(bridgeChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '1' })).toBe(1)
    expect(bridgeChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '56' })).toBe(56)
    expect(bridgeChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '42161' })).toBe(42161)
    expect(bridgeChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '8453' })).toBeNull()
    expect(bridgeChainIdOf({ walletType: 'tron', networkScope: 'mainnet', chainId: '' })).toBe(195)
    expect(bridgeChainIdOf({ walletType: 'tron', networkScope: 'testnet', chainId: '' })).toBeNull()
    expect(bridgeFamilyOf(0)).toBe('utxo')
    expect(bridgeFamilyOf(1)).toBe('evm')
    expect(bridgeFamilyOf(195)).toBe('tvm')
    expect(involvesBtc(0, 1)).toBe(true)
    expect(involvesBtc(1, 56)).toBe(false)
    expect(BRIDGE_API_PREFIX).toBe('/api/swapCross')
    expect([...BRIDGE_CHAIN_IDS]).toEqual([0, 1, 56, 42161, 195])
  })

  it('原生币用占位地址，比特币不允许代币', () => {
    expect(tokenAddressForBridge({ chainId: 0, isToken: false, contractAddress: null })).toBe(BTC_NATIVE_PLACEHOLDER)
    expect(tokenAddressForBridge({ chainId: 1, isToken: false, contractAddress: null })).toBe(EVM_NATIVE_PLACEHOLDER)
    expect(tokenAddressForBridge({ chainId: 195, isToken: false, contractAddress: '0' })).toBe(TRON_NATIVE_PLACEHOLDER)
    expect(
      tokenAddressForBridge({
        chainId: 1,
        isToken: true,
        contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      }),
    ).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(() => tokenAddressForBridge({ chainId: 0, isToken: true, contractAddress: 'x' })).toThrow(/原生 BTC/)
  })

  it('校验排序、报价序号和源链 hash', () => {
    expect(parseSortQuotesBy(undefined)).toBe('price')
    expect(parseSortQuotesBy('speed')).toBe('speed')
    expect(() => parseSortQuotesBy('fee')).toThrow(/排序/)
    expect(parseQuoteIndex(undefined)).toBe(0)
    expect(parseQuoteIndex(2)).toBe(2)
    expect(() => parseQuoteIndex(-1)).toThrow(/quoteIndex/)
    expect(originHashForBackend('evm', 'ab'.repeat(32))).toBe(`0x${'ab'.repeat(32)}`)
    expect(originHashForBackend('utxo', `0x${'cd'.repeat(32)}`)).toBe('cd'.repeat(32))
    expect(originHashForBackend('tvm', 'EF'.repeat(32))).toBe('ef'.repeat(32))
    expect(parseEstimatedSeconds(618.5)).toBe(619)
    expect(parseBridgeFeeText([{ amount: '1.2', asset: 'USDT' }])).toBe('1.2 USDT')
    expect(parseBridgeFeeText({ total: '0.3', symbol: 'USDT' })).toBe('0.3 USDT')
    expect(parseBridgeFeeText({})).toBe('')
    expect(
      parseBridgeNetworkFeeText(
        {
          gasCosts: [{ amount: '1000000000000000', token: { symbol: 'ETH', decimals: 18 } }],
        },
        'ETH',
        18,
      ),
    ).toBe('0.001 ETH')
    expect(
      parseBridgeNetworkFeeText({ fees: { gasFee: { amount: '2000000000000000', token: { symbol: 'ETH', decimals: 18 } } } }, 'ETH', 18),
    ).toBe('0.002 ETH')
    expect(formatGasLimitFee('250000', '20000000000', 'ETH', 18)).toBe('0.005 ETH')
    expect(
      parseBridgeNetworkFeeText(
        { transaction: { gas: '250000', gasPrice: '20000000000' } },
        'ETH',
        18,
      ),
    ).toBe('0.005 ETH')
  })

  it('解包询价、可执行报价、状态和历史', () => {
    const priced = parsePriceResponse({
      originChainId: 1,
      destinationChainId: 195,
      originAddress: '0xabc',
      destinationAddress: 'Tdest',
      liquidityAvailable: true,
      quotes: [
        {
          sellAmount: '10000000000000000',
          buyAmount: '30000000',
          minBuyAmount: '29700000',
          estimatedTimeSeconds: 90,
          fees: { total: '0.3', symbol: 'USDT' },
          gasCosts: [{ amount: '500000000000000', token: { symbol: 'ETH', decimals: 18 } }],
          issues: { allowance: { spender: '0xspender' } },
        },
      ],
    })
    expect(priced.options).toHaveLength(1)
    expect(priced.options[0]?.allowanceNeeded).toBe(true)
    expect(priced.options[0]?.allowanceTarget).toBe('0xspender')
    expect(priced.options[0]?.buyAmount).toBe('30000000')
    expect(priced.options[0]?.networkFeeText).toBe('0.0005 ETH')
    expect(priced.options[0]?.feeText).toBe('0.3 USDT')

    const quote = parseExecutableQuote({
      quoteId: '99',
      sellAmount: '1000',
      buyAmount: '2000',
      transaction: { chainType: 'evm', to: '0xabc', data: '0x12', value: '0' },
    })
    expect(quote.quoteId).toBe('99')
    expect(quote.transaction?.to).toBe('0xabc')

    const status = parseBridgeStatus({
      id: '99',
      status: 'BRIDGE',
      tx_hash: 'aa'.repeat(32),
      dest_tx_hash: '',
      estimated_time_seconds: 120,
    })
    expect(status.quoteId).toBe('99')
    expect(status.txHash).toBe('aa'.repeat(32))
    expect(status.destTxHash).toBeNull()

    const row = parseBridgeHistoryRow({
      id: '1',
      origin_chain_id: 0,
      destination_chain_id: 1,
      origin_address: 'bc1qfrom',
      destination_address: '0xdest',
      status: 'SUBMITTED',
      tx_hash: 'bb'.repeat(32),
      created: '2026-09-12T07:24:47.000Z',
    })
    expect(row.originChainId).toBe(0)
    expect(row.originAddress).toBe('bc1qfrom')
    expect(row.destinationAddress).toBe('0xdest')
    expect(row.txHash).toBe('bb'.repeat(32))
    expect(row.created).toBe('2026-09-12T07:24:47.000Z')
    expect(resolveBridgeHistoryStatus('SUBMITTED', 'aa'.repeat(32))).toBe('FILLED')
    expect(resolveBridgeHistoryStatus('ORIGIN_OK', null)).toBe('ORIGIN_OK')
    expect(parseBridgeHistoryRow({ ...row, dest_tx_hash: 'cc'.repeat(32), status: 'SUBMITTED' }).status).toBe('FILLED')
  })
})
