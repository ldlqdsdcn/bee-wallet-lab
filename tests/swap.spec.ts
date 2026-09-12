import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import {
  DEFAULT_SLIPPAGE_BPS,
  EVM_NATIVE_PLACEHOLDER,
  TRON_NATIVE_PLACEHOLDER,
  formatSwapFee,
  parseHistoryRow,
  parseQuoteAmounts,
  parseSlippageBps,
  parseWei,
  swapApiPrefix,
  swapChainIdOf,
  swapKindOf,
  tokenAddressForSwap,
} from '../electron/main/swap/codec'

describe('兑换 IPC', () => {
  it('通道已加入白名单', () => {
    expect(IPC.swapQuote).toBe('swap:quote')
    expect(IPC.swapSubmit).toBe('swap:submit')
    expect(IPC.swapList).toBe('swap:list')
    expect(IPC_CHANNELS).toContain(IPC.swapQuote)
    expect(IPC_CHANNELS).toContain(IPC.swapSubmit)
    expect(IPC_CHANNELS).toContain(IPC.swapList)
    expect(IPC.portfolioAccount).toBe('portfolio:account')
    expect(IPC_CHANNELS).toContain(IPC.portfolioAccount)
  })
})

describe('兑换 codec', () => {
  it('只开放 ETH / BSC / Arbitrum / 波场主网', () => {
    expect(swapChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '1' })).toBe(1)
    expect(swapChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '56' })).toBe(56)
    expect(swapChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '42161' })).toBe(42161)
    expect(swapChainIdOf({ walletType: 'web3', networkScope: 'mainnet', chainId: '8453' })).toBeNull()
    expect(swapChainIdOf({ walletType: 'tron', networkScope: 'mainnet', chainId: '' })).toBe(195)
    expect(swapChainIdOf({ walletType: 'tron', networkScope: 'testnet', chainId: '' })).toBeNull()
    expect(swapKindOf(1)).toBe('evm')
    expect(swapKindOf(195)).toBe('tron')
    expect(swapApiPrefix('evm')).toBe('/api/swap')
    expect(swapApiPrefix('tron')).toBe('/api/swapTron')
  })

  it('原生币用占位地址，合约用原地址', () => {
    expect(tokenAddressForSwap({ kind: 'evm', isToken: false, contractAddress: null })).toBe(EVM_NATIVE_PLACEHOLDER)
    expect(tokenAddressForSwap({ kind: 'tron', isToken: false, contractAddress: '0' })).toBe(TRON_NATIVE_PLACEHOLDER)
    expect(tokenAddressForSwap({ kind: 'evm', isToken: true, contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7' })).toBe(
      '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    )
  })

  it('校验滑点与金额', () => {
    expect(parseSlippageBps(undefined)).toBe(DEFAULT_SLIPPAGE_BPS)
    expect(parseSlippageBps(50)).toBe(50)
    expect(() => parseSlippageBps(20000)).toThrow(/滑点/)
    expect(parseWei('0x10')).toBe(16n)
    expect(parseWei('10000000')).toBe(10_000_000n)
    expect(formatSwapFee('13650000', 6, 'TRX')).toBe('约 13.65 TRX')
  })

  it('解包询价与历史', () => {
    const quote = parseQuoteAmounts({
      sellAmount: '10000000000000000',
      buyAmount: '30000000',
      minBuyAmount: '29700000',
      sellToken: EVM_NATIVE_PLACEHOLDER,
      buyToken: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      allowanceTarget: '0x0000000000001fF3684f28c67538d4D072C22734',
      gas: { networkFeeWei: '123', nativeSymbol: 'ETH' },
      issues: { allowance: { spender: '0x0000000000001fF3684f28c67538d4D072C22734' } },
      transaction: { to: '0xabc', data: '0x12', value: '0' },
      quoteId: '99',
    })
    expect(quote.allowanceNeeded).toBe(true)
    expect(quote.quoteId).toBe('99')
    expect(quote.buyAmount).toBe('30000000')
    const row = parseHistoryRow({ id: '1', chain_id: 56, status: 'SUBMITTED', tx_hash: '0xab' })
    expect(row.chainId).toBe(56)
    expect(row.txHash).toBe('0xab')
  })
})
