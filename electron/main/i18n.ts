import type { MessageKey } from '../../shared/i18n'
import { translate } from '../../shared/i18n'
import { loadSettings } from './db/repos/metaRepo'

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(loadSettings().language, key, vars)
}
