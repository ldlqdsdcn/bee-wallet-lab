import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import {
  assertMnemonic,
  assertPath,
  buildPath,
  derive,
  deriveAddress,
  deriveFromPrivateKey,
  generateMnemonicPhrase,
  isBitcoinAddress,
  isChecksumValid,
  isTronAddress,
  isSolanaAddress,
  isValidMnemonic,
  masterFingerprint,
  mnemonicToSeed,
  mnemonicWordCount,
  privateKeyToWif,
  toChecksumAddress,
  tronAddressFromEvmAddress,
  tronAddressToHex,
  wifToPrivateKey,
  encodeSolanaSecretKey,
  parseSolanaPrivateKey,
  deriveEvmRange,
  deriveHdRange,
  normalizeEvmRange,
} from '../electron/main/derive'
import { slip10DeriveEd25519 } from '../electron/main/derive/slip10'

/** BIP-39 官方向量：entropy 全零 */
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const SEED = mnemonicToSeed(MNEMONIC)

describe('BIP-39 助记词', () => {
  it('官方向量：passphrase=TREZOR 的种子逐字节一致', () => {
    expect(bytesToHex(mnemonicToSeed(MNEMONIC, 'TREZOR'))).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    )
  })

  it('passphrase 会改变整棵派生树', () => {
    expect(bytesToHex(mnemonicToSeed(MNEMONIC))).not.toBe(
      bytesToHex(mnemonicToSeed(MNEMONIC, 'TREZOR')),
    )
  })

  it('生成的助记词自校验通过且词数正确', () => {
    for (const wordCount of [12, 24] as const) {
      const phrase = generateMnemonicPhrase(wordCount)
      expect(isValidMnemonic(phrase)).toBe(true)
      expect(mnemonicWordCount(phrase)).toBe(wordCount)
    }
  })

  it('规范化：大小写与多余空白不影响校验结果', () => {
    expect(assertMnemonic(`  ${MNEMONIC.toUpperCase().replace(/ /g, '   ')}  `)).toBe(MNEMONIC)
  })

  it('拒绝校验和错误的助记词', () => {
    const broken = MNEMONIC.replace(/about$/, 'abandon')
    expect(isValidMnemonic(broken)).toBe(false)
    expect(() => assertMnemonic(broken)).toThrow()
  })

  it('主密钥指纹稳定且为 8 位 hex', () => {
    const fingerprint = masterFingerprint(SEED)
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/)
    expect(masterFingerprint(mnemonicToSeed(MNEMONIC))).toBe(fingerprint)
    expect(masterFingerprint(mnemonicToSeed(MNEMONIC, 'TREZOR'))).not.toBe(fingerprint)
  })
})

describe('派生路径', () => {
  it('BTC 四格式走各自的 BIP purpose，测试网 coin_type=1', () => {
    expect(buildPath({ walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2pkh' })).toBe(
      "m/44'/0'/0'/0/0",
    )
    expect(
      buildPath({ walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2sh-p2wpkh' }),
    ).toBe("m/49'/0'/0'/0/0")
    expect(
      buildPath({ walletType: 'bitcoin', networkScope: 'testnet', addressType: 'p2wpkh' }),
    ).toBe("m/84'/1'/0'/0/0")
    expect(buildPath({ walletType: 'bitcoin', networkScope: 'testnet', addressType: 'p2tr' })).toBe(
      "m/86'/1'/0'/0/0",
    )
  })

  it('EVM 60、TRON 195，且不随网络环境变化', () => {
    expect(buildPath({ walletType: 'web3', networkScope: 'mainnet' })).toBe("m/44'/60'/0'/0/0")
    expect(buildPath({ walletType: 'web3', networkScope: 'testnet' })).toBe("m/44'/60'/0'/0/0")
    expect(buildPath({ walletType: 'tron', networkScope: 'testnet' })).toBe("m/44'/195'/0'/0/0")
    expect(buildPath({ walletType: 'solana', networkScope: 'mainnet' })).toBe("m/44'/501'/0'/0'")
    expect(buildPath({ walletType: 'solana', networkScope: 'testnet', accountIndex: 1 })).toBe(
      "m/44'/501'/1'/0'",
    )
  })

  it('accountIndex 与 addressIndex 分别落在第 3、5 层', () => {
    expect(
      buildPath({ walletType: 'web3', networkScope: 'mainnet', accountIndex: 2, addressIndex: 7 }),
    ).toBe("m/44'/60'/2'/0/7")
  })

  it('自定义路径：h 归一为 \'，非法形态抛错', () => {
    expect(assertPath("m/44h/0h/0h/0/0")).toBe("m/44'/0'/0'/0/0")
    expect(() => assertPath('44/0/0')).toThrow()
    expect(() => assertPath('m/44/-1')).toThrow()
  })

  it('拒绝负数与非整数索引', () => {
    expect(() =>
      buildPath({ walletType: 'web3', networkScope: 'mainnet', accountIndex: -1 }),
    ).toThrow()
    expect(() =>
      buildPath({ walletType: 'web3', networkScope: 'mainnet', addressIndex: 1.5 }),
    ).toThrow()
  })
})

describe('Bitcoin 地址（官方测试向量）', () => {
  it('BIP-44 p2pkh 主网', () => {
    expect(
      deriveAddress({ seed: SEED, walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2pkh' })
        .address,
    ).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA')
  })

  it('BIP-49 p2sh-p2wpkh 测试网（地址与 WIF 均对齐 BIP-49 向量）', () => {
    const account = derive({
      seed: SEED,
      walletType: 'bitcoin',
      networkScope: 'testnet',
      addressType: 'p2sh-p2wpkh',
    })
    expect(account.rootPath).toBe("m/49'/1'/0'/0/0")
    expect(account.address).toBe('2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2')
    expect(privateKeyToWif(account.privateKey, 'testnet')).toBe(
      'cULrpoZGXiuC19Uhvykx7NugygA3k86b3hmdCeyvHYQZSxojGyXJ',
    )
  })

  it('BIP-84 p2wpkh 主网（地址、公钥、WIF 三项对齐）', () => {
    const account = derive({
      seed: SEED,
      walletType: 'bitcoin',
      networkScope: 'mainnet',
      addressType: 'p2wpkh',
    })
    expect(account.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
    expect(account.publicKey).toBe(
      '0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c',
    )
    expect(privateKeyToWif(account.privateKey, 'mainnet')).toBe(
      'KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d',
    )
  })

  it('BIP-84 第二个地址索引', () => {
    expect(
      deriveAddress({
        seed: SEED,
        walletType: 'bitcoin',
        networkScope: 'mainnet',
        addressType: 'p2wpkh',
        addressIndex: 1,
      }).address,
    ).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g')
  })

  it('BIP-86 p2tr 主网', () => {
    expect(
      deriveAddress({ seed: SEED, walletType: 'bitcoin', networkScope: 'mainnet', addressType: 'p2tr' })
        .address,
    ).toBe('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr')
  })

  it('四种格式互不相同，且测试网前缀正确', () => {
    const types = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const
    const testnet = types.map(
      (addressType) =>
        deriveAddress({ seed: SEED, walletType: 'bitcoin', networkScope: 'testnet', addressType })
          .address,
    )
    expect(new Set(testnet).size).toBe(4)
    expect(testnet[0]).toMatch(/^[mn]/)
    expect(testnet[1]).toMatch(/^2/)
    expect(testnet[2]).toMatch(/^tb1q/)
    expect(testnet[3]).toMatch(/^tb1p/)
    for (const address of testnet) {
      expect(isBitcoinAddress(address, 'testnet')).toBe(true)
      expect(isBitcoinAddress(address, 'mainnet')).toBe(false)
    }
  })

  it('WIF 解析回带出网络环境', () => {
    expect(wifToPrivateKey('KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d').networkScope).toBe(
      'mainnet',
    )
    expect(wifToPrivateKey('cULrpoZGXiuC19Uhvykx7NugygA3k86b3hmdCeyvHYQZSxojGyXJ').networkScope).toBe(
      'testnet',
    )
    expect(() => wifToPrivateKey('not-a-wif')).toThrow()
  })

  it('bitcoin 账户必须落上 addressType，默认 p2wpkh', () => {
    const account = deriveAddress({ seed: SEED, walletType: 'bitcoin', networkScope: 'mainnet' })
    expect(account.addressType).toBe('p2wpkh')
    expect(account.rootPath).toBe("m/84'/0'/0'/0/0")
  })
})

describe('EVM 地址', () => {
  it('m/44\'/60\'/0\'/0/0 对齐社区通用向量', () => {
    const account = deriveAddress({ seed: SEED, walletType: 'web3', networkScope: 'mainnet' })
    expect(account.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
    expect(account.addressType).toBeNull()
    expect(account.publicKey).toMatch(/^0x04[0-9a-f]{128}$/)
  })

  it('批量分层与逐条 derive 得到同一地址和私钥', () => {
    const rows = deriveEvmRange({ seed: SEED, fromIndex: 0, toIndex: 3 })
    expect(rows).toHaveLength(4)
    expect(rows[0]?.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
    expect(rows[0]?.path).toBe("m/44'/60'/0'/0/0")
    for (const row of rows) {
      const single = derive({
        seed: SEED,
        walletType: 'web3',
        networkScope: 'mainnet',
        addressIndex: row.index,
      })
      expect(row.path).toBe(single.rootPath)
      expect(row.address).toBe(single.address)
      expect(row.publicKey).toBe(single.publicKey)
      expect(row.privateKey).toBe(`0x${bytesToHex(single.privateKey)}`)
    }
  })

  it('波场 / Bitcoin / Solana 批量与逐条 derive 一致', () => {
    const tronRows = deriveHdRange({
      seed: SEED,
      walletType: 'tron',
      networkScope: 'mainnet',
      fromIndex: 0,
      toIndex: 2,
    })
    expect(tronRows[0]?.path).toBe("m/44'/195'/0'/0/0")
    expect(isTronAddress(tronRows[0]!.address)).toBe(true)
    for (const row of tronRows) {
      const single = derive({ seed: SEED, walletType: 'tron', networkScope: 'mainnet', addressIndex: row.index })
      expect(row.address).toBe(single.address)
      expect(row.privateKey).toBe(`0x${bytesToHex(single.privateKey)}`)
    }

    const btcRows = deriveHdRange({
      seed: SEED,
      walletType: 'bitcoin',
      networkScope: 'mainnet',
      fromIndex: 0,
      toIndex: 1,
    })
    expect(btcRows[0]?.path).toBe("m/84'/0'/0'/0/0")
    for (const row of btcRows) {
      const single = derive({ seed: SEED, walletType: 'bitcoin', networkScope: 'mainnet', addressIndex: row.index })
      expect(row.address).toBe(single.address)
      expect(row.privateKey).toBe(privateKeyToWif(single.privateKey, 'mainnet'))
    }

    const solRows = deriveHdRange({
      seed: SEED,
      walletType: 'solana',
      networkScope: 'mainnet',
      fromIndex: 0,
      toIndex: 2,
    })
    expect(solRows[0]?.path).toBe("m/44'/501'/0'/0'")
    expect(isSolanaAddress(solRows[0]!.address)).toBe(true)
    for (const row of solRows) {
      const single = derive({ seed: SEED, walletType: 'solana', networkScope: 'mainnet', addressIndex: row.index })
      expect(row.address).toBe(single.address)
      expect(row.privateKey).toBe(encodeSolanaSecretKey(single.privateKey))
    }
  })

  it('跳过已存在的序号，只派生缺口', () => {
    const rows = deriveEvmRange({ seed: SEED, fromIndex: 0, toIndex: 3, skipIndexes: [1, 2] })
    expect(rows.map((row) => row.index)).toEqual([0, 3])
  })

  it('一次最多 20000 个，结束序号不能更小', () => {
    expect(() => normalizeEvmRange(1, 20001)).toThrow(/20000/)
    expect(() => normalizeEvmRange(5, 4)).toThrow(/结束/)
    expect(normalizeEvmRange(1, 20000)).toEqual({ fromIndex: 1, toIndex: 20000 })
  })

  it('EIP-55 校验和大小写正确', () => {
    // EIP-55 规范用例
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    )
    expect(toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe(
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    )
    expect(isChecksumValid('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBe(true)
    expect(isChecksumValid('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD')).toBe(false)
    // 全小写视为未加校验和，放行
    expect(isChecksumValid('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(true)
  })

  it('导入私钥：secp256k1 生成元对应的已知地址', () => {
    const imported = deriveFromPrivateKey({
      walletType: 'web3',
      networkScope: 'mainnet',
      privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
    })
    expect(imported.address).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')
    expect(imported.addressType).toBeNull()
  })

  it('拒绝长度不合法的私钥', () => {
    expect(() =>
      deriveFromPrivateKey({ walletType: 'web3', networkScope: 'mainnet', privateKey: '0x1234' }),
    ).toThrow()
  })
})

describe('TRON 地址', () => {
  it('已知 hex/Base58 对（USDT-TRC20 合约地址）', () => {
    expect(tronAddressFromEvmAddress('0xa614f803b6fd780986a42c78ec9c7f77e6ded13c')).toBe(
      'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    )
    expect(tronAddressToHex('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(
      '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
    )
  })

  it('派生结果形态正确，且与同一把私钥的 EVM 地址一一对应', () => {
    const tron = derive({ seed: SEED, walletType: 'tron', networkScope: 'mainnet' })
    expect(tron.rootPath).toBe("m/44'/195'/0'/0/0")
    expect(isTronAddress(tron.address)).toBe(true)
    // TRON 与 EVM 共用 keccak256 后 20 字节，仅编码不同
    const evm = deriveAddress({
      seed: SEED,
      walletType: 'web3',
      networkScope: 'mainnet',
      customPath: "m/44'/195'/0'/0/0",
    })
    expect(tronAddressFromEvmAddress(evm.address)).toBe(tron.address)
  })

  it('拒绝校验和错误的 TRON 地址', () => {
    expect(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u')).toBe(false)
    expect(isTronAddress('0xa614f803b6fd780986a42c78ec9c7f77e6ded13c')).toBe(false)
  })
})

describe('私钥生命周期', () => {
  it('deriveAddress 不泄露私钥字段', () => {
    const account = deriveAddress({ seed: SEED, walletType: 'web3', networkScope: 'mainnet' })
    expect('privateKey' in account).toBe(false)
  })

  it('derive 返回的私钥是拷贝，可安全 wipe', () => {
    const a = derive({ seed: SEED, walletType: 'web3', networkScope: 'mainnet' })
    const b = derive({ seed: SEED, walletType: 'web3', networkScope: 'mainnet' })
    expect(bytesToHex(a.privateKey)).toBe(bytesToHex(b.privateKey))
    a.privateKey.fill(0)
    expect(bytesToHex(b.privateKey)).not.toMatch(/^0{64}$/)
  })
})

describe('Solana 地址', () => {
  it('SLIP-0010 官方向量 seed=0001..0f 的 m 与 m/0\'', () => {
    const seed = hexToBytes('000102030405060708090a0b0c0d0e0f')
    expect(bytesToHex(slip10DeriveEd25519(seed, 'm'))).toBe(
      '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
    )
    expect(bytesToHex(slip10DeriveEd25519(seed, "m/0'"))).toBe(
      '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
    )
  })

  it('Phantom 默认路径 m/44\'/501\'/0\'/0\' 给出合法 Base58 地址', () => {
    const account = derive({ seed: SEED, walletType: 'solana', networkScope: 'mainnet' })
    expect(account.rootPath).toBe("m/44'/501'/0'/0'")
    expect(account.addressType).toBeNull()
    expect(isSolanaAddress(account.address)).toBe(true)
    expect(account.address).toBe('HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk')
  })

  it('secret key 可往返导入', () => {
    const account = derive({ seed: SEED, walletType: 'solana', networkScope: 'mainnet' })
    const encoded = encodeSolanaSecretKey(account.privateKey)
    const imported = deriveFromPrivateKey({
      walletType: 'solana',
      networkScope: 'mainnet',
      privateKey: encoded,
    })
    expect(imported.address).toBe(account.address)
    expect(bytesToHex(parseSolanaPrivateKey(encoded))).toBe(bytesToHex(account.privateKey))
  })
})
