import { describe, expect, it } from 'vitest'
import { collectRecipientAddresses, mergeRecipientText, parseRecipientTokens } from '../shared/airdropAddresses'
import { matchAddressKeyword, matchBalanceRange, uniquePayersByAddress } from '../src/lib/airdropPayer'
import { IPC, IPC_CHANNELS, IPC_EVENT, IPC_EVENTS } from '../shared/ipc'
import { parseDecimalToMinor } from '../electron/main/util/amount'
import {
  estimateAirdropDurationMs,
  formatDuration,
  randomBigIntInclusive,
} from '../electron/main/hdAirdrop/amount'

describe('批量转账收款地址', () => {
  const a = '0x1111111111111111111111111111111111111111'
  const b = '0x2222222222222222222222222222222222222222'

  it('按逗号、中文逗号和换行拆分', () => {
    expect(parseRecipientTokens(`${a},${b}`)).toEqual([a, b])
    expect(parseRecipientTokens(`${a}，${b}`)).toEqual([a, b])
    expect(parseRecipientTokens(`${a}\n${b}`)).toEqual([a, b])
  })

  it('去掉重复并标出非法项', () => {
    const result = collectRecipientAddresses(`${a},0x${a.slice(2).toUpperCase()},not-an-address,${b}`)
    expect(result.addresses).toEqual([a, b])
    expect(result.invalid).toEqual(['not-an-address'])
    expect(result.duplicateCount).toBe(1)
  })

  it('合并文本时按小写去重并保持原有顺序', () => {
    expect(mergeRecipientText(a, `${a},${b}`)).toBe(`${a},${b}`)
  })
})

describe('批量转账付款筛选', () => {
  it('相同地址只保留第一条', () => {
    const a = '0x1111111111111111111111111111111111111111'
    expect(
      uniquePayersByAddress([
        { address: a, label: '主账户' },
        { address: a.toUpperCase(), label: 'EVM' },
        { address: '0x2222222222222222222222222222222222222222', label: 'HD #1' },
      ]).map((item) => item.label),
    ).toEqual(['主账户', 'HD #1'])
  })

  it('按地址片段模糊匹配', () => {
    expect(matchAddressKeyword('0xAbcDef', 'bcd')).toBe(true)
    expect(matchAddressKeyword('0xAbcDef', 'zzz')).toBe(false)
  })

  it('按余额范围筛选，未读到余额时不进入范围条件', () => {
    expect(matchBalanceRange('1.5', '1', '2')).toBe(true)
    expect(matchBalanceRange('0.2', '1', '')).toBe(false)
    expect(matchBalanceRange(null, '1', '2')).toBe(false)
    expect(matchBalanceRange(null, '', '')).toBe(true)
  })
})

describe('批量转账金额', () => {
  it('固定额度按代币精度换成最小单位', () => {
    expect(parseDecimalToMinor('1000', 18)).toBe(1000n * 10n ** 18n)
    expect(parseDecimalToMinor('1000.5', 6)).toBe(1000500000n)
  })

  it('上下限相同时返回该值', () => {
    expect(randomBigIntInclusive(7n, 7n)).toBe(7n)
  })

  it('随机值始终落在闭区间内', () => {
    for (let i = 0; i < 80; i += 1) {
      const value = randomBigIntInclusive(1000n, 2000n)
      expect(value >= 1000n && value <= 2000n).toBe(true)
    }
  })

  it('上限小于下限会报错', () => {
    expect(() => randomBigIntInclusive(2000n, 1000n)).toThrow(/上限/)
  })
})

describe('批量转账耗时', () => {
  it('两万笔按 450ms 一笔大约 2.5 小时', () => {
    expect(estimateAirdropDurationMs(20_000)).toBe(9_000_000)
    expect(formatDuration(9_000_000)).toBe('约 2 小时 30 分钟')
    expect(formatDuration(60_000)).toBe('约 1 分钟')
    expect(formatDuration(8_000)).toBe('约 8 秒')
  })
})

describe('批量转账通道', () => {
  it('预览、开始、停止、进度已加入白名单', () => {
    expect(IPC.hdAirdropPreview).toBe('hdAirdrop:preview')
    expect(IPC.hdAirdropStart).toBe('hdAirdrop:start')
    expect(IPC.hdAirdropStop).toBe('hdAirdrop:stop')
    expect(IPC.hdAirdropStatus).toBe('hdAirdrop:status')
    expect(IPC.hdAirdropJobs).toBe('hdAirdrop:jobs')
    expect(IPC.hdAirdropItems).toBe('hdAirdrop:items')
    expect(IPC.hdAirdropRetry).toBe('hdAirdrop:retry')
    expect(IPC_CHANNELS).toContain(IPC.hdAirdropPreview)
    expect(IPC_CHANNELS).toContain(IPC.hdAirdropRetry)
    expect(IPC.portfolioTokenBalances).toBe('portfolio:tokenBalances')
    expect(IPC_CHANNELS).toContain(IPC.portfolioTokenBalances)
    expect(IPC_EVENT.hdAirdropProgress).toBe('event:hdAirdropProgress')
    expect(IPC_EVENTS).toContain(IPC_EVENT.hdAirdropProgress)
  })
})

describe('分层钱包详情', () => {
  it('单条揭示私钥通道已加入白名单', () => {
    expect(IPC.accountHdKeyReveal).toBe('account:hdKeyReveal')
    expect(IPC_CHANNELS).toContain(IPC.accountHdKeyReveal)
  })
})
