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
import {
  buildMetaplexJson,
  METAPLEX_MAX_URI,
  normalizeSolanaIssueFields,
  normalizeSolanaMetadata,
  SOLANA_U64_MAX,
} from '../electron/main/token/solanaIssue'
import {
  encodeCreateMetadataV3,
  encodeInitializeMint2,
  encodeMintTo,
  encodeSetMintAuthorityNone,
  metadataAddress,
} from '../electron/main/chain/solana'

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

describe('固定总量 SPL 参数', () => {
  it('默认精度 9，总量不能超过 u64', () => {
    const fields = normalizeSolanaIssueFields({ name: 'Bee Token', symbol: 'bee' })
    expect(fields.decimals).toBe(9)
    expect(fields.supplyMinor).toBe(1000000000n * 10n ** 9n)
    expect(() => normalizeSolanaIssueFields({ name: 'Bee', symbol: 'BEE', decimals: 10 })).toThrow(/精度/)
    expect(() =>
      normalizeSolanaIssueFields({
        name: 'Bee',
        symbol: 'BEE',
        decimals: 0,
        supply: (SOLANA_U64_MAX + 1n).toString(),
      }),
    ).toThrow(/最大值/)
  })

  it('InitializeMint2 / MintTo / 关掉增发的指令码正确', () => {
    const mintAuth = '11111111111111111111111111111111'
    const init = encodeInitializeMint2(9, mintAuth)
    expect(init[0]).toBe(20)
    expect(init[1]).toBe(9)
    expect(init.length).toBe(2 + 32 + 4)
    expect(encodeMintTo(100n)[0]).toBe(7)
    expect(encodeSetMintAuthorityNone()[0]).toBe(6)
    expect(encodeSetMintAuthorityNone()[1]).toBe(0)
  })

  it('名称最长 32、符号最长 10', () => {
    expect(() => normalizeSolanaIssueFields({ name: 'x'.repeat(33), symbol: 'BEE' })).toThrow(/名称/)
    expect(() => normalizeSolanaIssueFields({ name: 'Bee', symbol: 'ABCDEFGHIJK' })).toThrow(/符号/)
    expect(normalizeSolanaIssueFields({ name: 'x'.repeat(32), symbol: 'ABCDEFGHIJ' }).symbol).toBe('ABCDEFGHIJ')
  })

  it('生成含 logo、官网的 Metaplex JSON，并校验 URI 长度', () => {
    const json = buildMetaplexJson({
      name: 'Bee Token',
      symbol: 'BEE',
      description: 'lab token',
      logoUrl: 'https://example.com/bee.png',
      website: 'https://example.com',
    })
    expect(JSON.parse(json)).toEqual({
      name: 'Bee Token',
      symbol: 'BEE',
      description: 'lab token',
      image: 'https://example.com/bee.png',
      external_url: 'https://example.com',
    })
    const fields = normalizeSolanaMetadata({
      name: 'Bee Token',
      symbol: 'BEE',
      logoUrl: 'https://example.com/bee.png',
      website: 'https://example.com',
      metadataUri: 'https://example.com/meta.json',
    })
    expect(fields.metadataUri).toBe('https://example.com/meta.json')
    expect(() =>
      normalizeSolanaMetadata({
        name: 'Bee',
        symbol: 'BEE',
        metadataUri: `https://example.com/${'a'.repeat(METAPLEX_MAX_URI)}`,
      }),
    ).toThrow(/太长|200/)
    expect(() =>
      normalizeSolanaMetadata({
        name: 'Bee',
        symbol: 'BEE',
        logoUrl: 'ftp://example.com/bee.png',
      }),
    ).toThrow(/Logo/)
  })

  it('能算出 Metaplex metadata PDA，并把 URI 写进 CreateMetadataAccountV3', () => {
    const mint = 'So11111111111111111111111111111111111111112'
    const meta = metadataAddress(mint)
    expect(meta.length).toBeGreaterThanOrEqual(32)
    expect(meta).not.toBe(mint)
    const uri = 'https://example.com/meta.json'
    const data = encodeCreateMetadataV3('Bee Token', 'BEE', uri, true)
    expect(data[0]).toBe(33)
    expect(Buffer.from(data).includes(Buffer.from(uri))).toBe(true)
  })
})

describe('发行记录通道', () => {
  it('列表通道已加入白名单', () => {
    expect(IPC.tokenIssueList).toBe('token:issueList')
    expect(IPC_CHANNELS).toContain(IPC.tokenIssueList)
  })
})
