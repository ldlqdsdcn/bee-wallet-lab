import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import { abiCalldataToTronParameter, encodeAbiCall, isReadFunction, parseAbiDocument } from '../electron/main/abi/codec'
import { ERC20_ABI } from '../electron/main/abi/presets'
import { tronAddressFromEvmAddress } from '../electron/main/derive/tron'
import { normalizeContractAddress } from '../electron/main/contract/address'

const ABI_JSON = JSON.stringify(ERC20_ABI)
const ZERO = '0x1111111111111111111111111111111111111111'

describe('合约交互 IPC', () => {
  it('读取 / 预览 / 只签名通道已加入白名单', () => {
    expect(IPC.contractRead).toBe('contract:read')
    expect(IPC.contractPreview).toBe('contract:preview')
    expect(IPC.contractSign).toBe('contract:sign')
    expect(IPC_CHANNELS).toContain(IPC.contractRead)
    expect(IPC_CHANNELS).toContain(IPC.contractPreview)
    expect(IPC_CHANNELS).toContain(IPC.contractSign)
  })
})

describe('合约 ABI 分类', () => {
  it('ERC-20 能区分只读和写入函数', () => {
    const parsed = parseAbiDocument(ABI_JSON)
    const reads = parsed.functions.filter((item) => isReadFunction(item.stateMutability)).map((item) => item.name)
    const writes = parsed.functions.filter((item) => !isReadFunction(item.stateMutability)).map((item) => item.name)
    expect(reads).toEqual(expect.arrayContaining(['balanceOf', 'name', 'decimals']))
    expect(writes).toEqual(expect.arrayContaining(['transfer', 'approve']))
    expect(reads).not.toContain('transfer')
  })
})

describe('合约 calldata', () => {
  it('去掉 selector 后得到 TRON parameter', () => {
    const encoded = encodeAbiCall(ABI_JSON, 'transfer(address,uint256)', [ZERO, '1000'])
    const parameter = abiCalldataToTronParameter(encoded.calldata)
    expect(encoded.calldata.startsWith('0xa9059cbb')).toBe(true)
    expect(parameter).toBe(encoded.calldata.slice(10))
    expect(parameter.length).toBe(128)
  })
})

describe('合约地址规范化', () => {
  it('EVM 校验 checksum，TRON 接受 T 地址或 0x', () => {
    const evm = normalizeContractAddress('web3', ZERO)
    expect(evm.toLowerCase()).toBe(ZERO)
    expect(normalizeContractAddress('tron', tronAddressFromEvmAddress(ZERO))).toMatch(/^T/)
    expect(normalizeContractAddress('tron', ZERO)).toBe(tronAddressFromEvmAddress(ZERO))
    expect(() => normalizeContractAddress('solana', ZERO)).toThrow(/不支持合约交互/)
  })
})
