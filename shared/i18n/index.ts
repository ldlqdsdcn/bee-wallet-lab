import type { AppLocale } from '../types'
import { interpolate, normalizeLocale } from '../locale'
import { zh } from './zh'
import { en } from './en'

export { zh } from './zh'
export { en } from './en'

export type MessageKey = keyof typeof zh

const dictionaries: Record<AppLocale, Record<MessageKey, string>> = {
  'zh-CN': zh,
  en,
}

export function translate(
  locale: string | null | undefined,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const dict = dictionaries[normalizeLocale(locale)]
  return interpolate(dict[key] ?? dictionaries['zh-CN'][key] ?? key, vars)
}

export function messageKeys(): MessageKey[] {
  return Object.keys(zh) as MessageKey[]
}
