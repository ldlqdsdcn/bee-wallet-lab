import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import { decodeDeployData, type Abi, type Hex } from 'viem'
import artifact from '../electron/main/token/beeFixedErc20.json'
import { toChecksumAddress } from '../electron/main/derive/evm'
import {
  artifactBytecode,
  encodeFixedErc20Deploy,
  normalizeIssueFields,
  parseCreatedContract,
} from '../electron/main/token/encode'

describe('固定总量 ERC-20 参数', () => {
  it('默认总量是 10 亿、精度 18', () => {
    const fields = normalizeIssueFields({ name: 'Bee Token', symbol: 'bee' })
    expect(fields).toMatchObject({
      name: 'Bee Token',
      symbol: 'BEE',
      decimals: 18,
      supply: '1000000000',
    })
    expect(fields.supplyMinor).toBe(1000000000n * 10n ** 18n)
  })

  it('拒绝空名称、非法符号、超精度和零总量', () => {
    expect(() => normalizeIssueFields({ name: '  ', symbol: 'BEE' })).toThrow(/名称/)
    expect(() => normalizeIssueFields({ name: 'Bee', symbol: 'be-e' })).toThrow(/符号/)
    expect(() => normalizeIssueFields({ name: 'Bee', symbol: 'BEE', decimals: 19 })).toThrow(/精度/)
    expect(() => normalizeIssueFields({ name: 'Bee', symbol: 'BEE', supply: '0' })).toThrow(/大于 0/)
    expect(() => normalizeIssueFields({ name: 'Bee', symbol: 'BEE', decimals: 2, supply: '1.234' })).toThrow(/精度/)
  })
})

describe('固定总量 ERC-20 部署数据', () => {
  it('bytecode 后跟上构造参数', () => {
    const fields = normalizeIssueFields({
      name: 'Bee Token',
      symbol: 'BEE',
      decimals: 18,
      supply: '1000000000',
    })
    const data = encodeFixedErc20Deploy(fields)
    const bytecode = artifactBytecode()
    expect(data.startsWith(bytecode)).toBe(true)
    expect(data.length).toBeGreaterThan(bytecode.length)

    const decoded = decodeDeployData({
      abi: artifact.abi as Abi,
      bytecode: artifact.bytecode as Hex,
      data,
    })
    expect(decoded.args).toEqual(['Bee Token', 'BEE', 18, fields.supplyMinor])
  })

  it('从回执里取出合约地址', () => {
    expect(parseCreatedContract({ contractAddress: '0x0000000000000000000000000000000000000000' })).toBeNull()
    expect(parseCreatedContract({ contractAddress: '0x1111111111111111111111111111111111111111' })).toBe(
      toChecksumAddress('0x1111111111111111111111111111111111111111'),
    )
    expect(parseCreatedContract(null)).toBeNull()
  })
})

describe('发行记录通道', () => {
  it('列表通道已加入白名单', () => {
    expect(IPC.tokenIssueList).toBe('token:issueList')
    expect(IPC_CHANNELS).toContain(IPC.tokenIssueList)
  })
})
