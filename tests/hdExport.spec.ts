import { describe, expect, it } from 'vitest'
import { hdAddressListText, hdExportFilename, parseHdIndexRange } from '../src/lib/hdExport'

describe('分层地址导出', () => {
  it('把地址写成逗号分隔文本', () => {
    expect(hdAddressListText([])).toBe('')
    expect(hdAddressListText([' 0xabc ', '', '0xdef'])).toBe('0xabc,0xdef')
  })

  it('解析含两端的序号范围', () => {
    expect(parseHdIndexRange('1', '500')).toEqual({ fromIndex: 1, toIndex: 500 })
    expect(parseHdIndexRange('0', '0')).toEqual({ fromIndex: 0, toIndex: 0 })
    expect(parseHdIndexRange('10', '9')).toBeNull()
    expect(parseHdIndexRange('1.5', '8')).toBeNull()
  })

  it('文件名去掉路径字符', () => {
    expect(hdExportFilename('Bee/主钱包', 'hd-addresses.txt')).toBe('Bee-主钱包-hd-addresses.txt')
    expect(hdExportFilename('   ', 'hd-addresses.txt')).toBe('hd-hd-addresses.txt')
  })
})
