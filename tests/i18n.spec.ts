import { describe, expect, it } from 'vitest'
import { en, messageKeys, translate, zh } from '../shared/i18n'
import { interpolate, normalizeLocale } from '../shared/locale'

describe('i18n', () => {
  it('keeps Chinese and English keys in sync', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(messageKeys().length).toBeGreaterThan(100)
  })

  it('normalizes locale aliases', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('ja')).toBe('zh-CN')
  })

  it('interpolates and switches language', () => {
    expect(interpolate('Hello {name}', { name: 'Bee' })).toBe('Hello Bee')
    expect(translate('zh-CN', 'nav.home')).toBe('资产总览')
    expect(translate('en', 'nav.home')).toBe('Portfolio')
    expect(translate('en', 'settings.minutes', { minutes: 5 })).toBe('5 minutes')
  })
})
