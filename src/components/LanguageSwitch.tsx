import type { AppLocale } from '@shared/types'
import { LOCALES } from '@shared/locale'
import { useT } from '../i18n'
import { useVaultStore } from '../store/vaultStore'

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const language = useVaultStore((s) => s.settings?.language ?? 'zh-CN')
  const updateSettings = useVaultStore((s) => s.updateSettings)

  return (
    <div>
      {compact ? null : (
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-600">
          {t('lang.switch')}
        </span>
      )}
      <div className="flex rounded-lg border border-ink-600 p-0.5">
        {LOCALES.map((locale: AppLocale) => {
          const active = language === locale
          return (
            <button
              key={locale}
              type="button"
              className={`flex-1 rounded-md px-2 py-1 text-[11px] ${
                active ? 'bg-ink-700 text-honey-400' : 'text-ink-400 hover:text-ink-200'
              }`}
              onClick={() => {
                if (language !== locale) void updateSettings({ language: locale })
              }}
            >
              {locale === 'en' ? t('lang.en') : t('lang.zh')}
            </button>
          )
        })}
      </div>
    </div>
  )
}
