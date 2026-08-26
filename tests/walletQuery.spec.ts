import { describe, expect, it } from 'vitest'
import { escapeLike, normalizePickerQuery, WALLET_PICKER_PAGE_SIZE } from '../electron/main/wallets/query'

describe('钱包选择器查询', () => {
  it('默认每页 30 条，页码从 1 起', () => {
    expect(normalizePickerQuery({})).toEqual({ name: '', page: 1, pageSize: WALLET_PICKER_PAGE_SIZE })
    expect(normalizePickerQuery({ page: 0, pageSize: 0 }).page).toBe(1)
    expect(normalizePickerQuery({ pageSize: 999 }).pageSize).toBe(100)
  })

  it('LIKE 转义 % _ \\', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })
})
