import { useCallback } from 'react'
import type { MessageKey } from '@shared/i18n'
import { translate } from '@shared/i18n'
import { normalizeLocale } from '@shared/locale'
import { useVaultStore } from '../store/vaultStore'

export type { MessageKey } from '@shared/i18n'
export { translate } from '@shared/i18n'

export function useLocale() {
  return normalizeLocale(useVaultStore((s) => s.settings?.language))
}

export function useT() {
  const locale = useLocale()
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  )
}
