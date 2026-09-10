import { describe, expect, it } from 'vitest'
import { encodeFunctionResult, toEventSelector, toFunctionSelector } from 'viem'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import {
  decodeAbiCalldata,
  decodeAbiEventLog,
  decodeAbiReturn,
  encodeAbiCall,
  parseAbiDocument,
  parseTopics,
} from '../electron/main/abi/codec'
import { ERC20_ABI } from '../electron/main/abi/presets'
import { tronAddressFromEvmAddress } from '../electron/main/derive/tron'

const ABI_JSON = JSON.stringify(ERC20_ABI)
const ZERO = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'

describe('ABI 工具 IPC', () => {
  it('解析 / 编解码通道已加入白名单', () => {
    expect(IPC.abiParse).toBe('abi:parse')
    expect(IPC.abiPreset).toBe('abi:preset')
    expect(IPC.abiEncode).toBe('abi:encode')
    expect(IPC.abiDecodeCall).toBe('abi:decodeCall')
    expect(IPC.abiDecodeResult).toBe('abi:decodeResult')
    expect(IPC.abiDecodeEvent).toBe('abi:decodeEvent')
    expect(IPC_CHANNELS).toContain(IPC.abiList)
    expect(IPC_CHANNELS).toContain(IPC.abiUpsert)
    expect(IPC_CHANNELS).toContain(IPC.abiRemove)
  })
})

describe('ABI 解析', () => {
  it('列出 ERC-20 函数和事件', () => {
    const parsed = parseAbiDocument(ABI_JSON, 'ERC-20')
    expect(parsed.name).toBe('ERC-20')
    expect(parsed.functions.map((item) => item.name)).toEqual(
      expect.arrayContaining(['transfer', 'approve', 'balanceOf']),
    )
    expect(parsed.events.map((item) => item.name)).toEqual(expect.arrayContaining(['Transfer', 'Approval']))
    const transfer = parsed.functions.find((item) => item.signature === 'transfer(address,uint256)')
    expect(transfer?.selector).toBe(toFunctionSelector('transfer(address,uint256)'))
    expect(parsed.events.find((item) => item.name === 'Transfer')?.topic0).toBe(
      toEventSelector('Transfer(address,address,uint256)'),
    )
  })

  it('能从编译产物里取出 abi 数组', () => {
    const parsed = parseAbiDocument(JSON.stringify({ contractName: 'Token', abi: ERC20_ABI }))
    expect(parsed.name).toBe('Token')
    expect(parsed.functions.length).toBeGreaterThan(0)
  })
})

describe('ABI 编解码', () => {
  it('编码 transfer 再按 calldata 解回参数', () => {
    const encoded = encodeAbiCall(ABI_JSON, 'transfer(address,uint256)', [ZERO, '1000'])
    expect(encoded.selector).toBe('0xa9059cbb')
    expect(encoded.calldata.startsWith('0xa9059cbb')).toBe(true)

    const decoded = decodeAbiCalldata(ABI_JSON, encoded.calldata)
    expect(decoded.signature).toBe('transfer(address,uint256)')
    expect(decoded.args[0]?.value.toLowerCase()).toBe(ZERO)
    expect(decoded.args[1]?.value).toBe('1000')
  })

  it('接受 TRON 地址并转成 0x 再编码', () => {
    const encoded = encodeAbiCall(ABI_JSON, 'transfer(address,uint256)', [tronAddressFromEvmAddress(ZERO), '1'])
    const decoded = decodeAbiCalldata(ABI_JSON, encoded.calldata)
    expect(decoded.args[0]?.value.toLowerCase()).toBe(ZERO)
  })

  it('解码 balanceOf 返回值', () => {
    const data = encodeFunctionResult({
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      result: 123n,
    })
    const decoded = decodeAbiReturn(ABI_JSON, 'balanceOf(address)', data)
    expect(decoded.values[0]?.value).toBe('123')
  })

  it('解码 Transfer event log', () => {
    const topic0 = toEventSelector('Transfer(address,address,uint256)')
    const topics = [
      topic0,
      `0x${ZERO.slice(2).padStart(64, '0')}`,
      `0x${OTHER.slice(2).padStart(64, '0')}`,
    ].join('\n')
    const data = `0x${(1000n).toString(16).padStart(64, '0')}`
    const decoded = decodeAbiEventLog(ABI_JSON, data, topics)
    expect(decoded.name).toBe('Transfer')
    expect(decoded.args.find((item) => item.name === 'from')?.value.toLowerCase()).toBe(ZERO)
    expect(decoded.args.find((item) => item.name === 'to')?.value.toLowerCase()).toBe(OTHER)
    expect(decoded.args.find((item) => item.name === 'value')?.value).toBe('1000')
  })

  it('解析一行一个 topic', () => {
    const topics = parseTopics('0x11\n0x22')
    expect(topics).toEqual(['0x11', '0x22'])
  })
})
