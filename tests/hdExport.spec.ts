import { describe, expect, it } from 'vitest'
import { hdAddressListText, hdExportFilename } from '../src/lib/hdExport'

describe('分层地址导出', () => {
  it('把地址写成逗号分隔文本', () => {
    expect(hdAddressListText([])).toBe('')
    expect(hdAddressListText([' 0xabc ', '', '0xdef'])).toBe('0xabc,0xdef')
  })

  it('文件名去掉路径字符', () => {
    expect(hdExportFilename('Bee/主钱包', 'hd-addresses.txt')).toBe('Bee-主钱包-hd-addresses.txt')
    expect(hdExportFilename('   ', 'hd-addresses.txt')).toBe('hd-hd-addresses.txt')
  })
})
