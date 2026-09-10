import type { AppLocale } from './types'

export const LOCALES: readonly AppLocale[] = ['zh-CN', 'en']

export function normalizeLocale(value: unknown): AppLocale {
  if (value === 'en' || value === 'en-US' || value === 'en-GB') return 'en'
  return 'zh-CN'
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] == null ? `{${key}}` : String(vars[key]),
  )
}
