import { useEffect, useState } from 'react'
import type { CurrencyRecord } from '@shared/types'
import { useVaultStore } from '../store/vaultStore'
import { catalogApi, vaultApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { useT } from '../i18n'

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 0]

export default function SettingsPage() {
  const t = useT()
  const settings = useVaultStore((s) => s.settings)
  const updateSettings = useVaultStore((s) => s.updateSettings)

  const [baseUrl, setBaseUrl] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currencies, setCurrencies] = useState<CurrencyRecord[]>([])

  useEffect(() => {
    if (settings) setBaseUrl(settings.baseUrl)
  }, [settings])

  useEffect(() => {
    void catalogApi.currencies().then(setCurrencies).catch(() => undefined)
  }, [])

  const changePassword = async () => {
    setError(null)
    setMessage(null)
    if (newPassword !== confirmPassword) {
      setError(t('settings.passwordMismatch'))
      return
    }
    try {
      await vaultApi.changePassword(oldPassword, newPassword)
      setMessage(t('settings.passwordUpdated'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-lg font-semibold text-ink-200">{t('settings.title')}</h1>
      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title={t('settings.language')}>
        <p className="mb-3 text-xs text-ink-400">{t('settings.languageHint')}</p>
        <LanguageSwitch />
      </Card>

      <Card title={t('settings.catalog')}>
        <div className="space-y-3">
          <p className="text-xs text-ink-400">{t('settings.catalogHint')}</p>
          <Button
            variant="ghost"
            onClick={() =>
              void catalogApi
                .sync(true)
                .then((result) =>
                  setMessage(
                    t('settings.catalogDone', {
                      networks: result.networks,
                      tokens: result.tokens,
                      currencies: result.currencies,
                    }),
                  ),
                )
                .then(() => catalogApi.currencies().then(setCurrencies))
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            }
          >
            {t('settings.reloadCatalog')}
          </Button>
          <Field
            label={t('settings.catalogUrl')}
            value={baseUrl}
            hint={t('settings.catalogUrlHint')}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <Button
            disabled={baseUrl === (settings?.baseUrl ?? '')}
            onClick={() => void updateSettings({ baseUrl: baseUrl.replace(/\/+$/, '') })}
          >
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card title={t('settings.fiat')}>
        <Select
          label={t('settings.currency')}
          value={settings?.currencyCode ?? 'CNY'}
          onChange={(e) => void updateSettings({ currencyCode: e.target.value })}
        >
          {(currencies.length ? currencies : [{ id: 'cny', code: 'CNY', name: 'CNY', symbol: '¥', syncedAt: 0 }]).map(
            (item) => (
              <option key={item.id} value={item.code}>
                {item.code} {item.name ? `· ${item.name}` : ''}
              </option>
            ),
          )}
        </Select>
      </Card>

      <Card title={t('settings.autoLock')}>
        <p className="mb-3 text-xs text-ink-500">{t('settings.autoLockHint')}</p>
        <div className="flex flex-wrap gap-2">
          {AUTO_LOCK_OPTIONS.map((minutes) => (
            <Button
              key={minutes}
              variant={settings?.autoLockMinutes === minutes ? 'primary' : 'ghost'}
              onClick={() => void updateSettings({ autoLockMinutes: minutes })}
            >
              {minutes === 0 ? t('settings.neverLock') : t('settings.minutes', { minutes })}
            </Button>
          ))}
        </div>
      </Card>

      <Card title={t('settings.password')}>
        <div className="space-y-3">
          <Field
            label={t('settings.oldPassword')}
            type="password"
            autoComplete="off"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
          <Field
            label={t('settings.newPassword')}
            type="password"
            autoComplete="off"
            value={newPassword}
            hint={t('settings.newPasswordHint')}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Field
            label={t('settings.confirmPassword')}
            type="password"
            autoComplete="off"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button
            disabled={!oldPassword || !newPassword}
            onClick={() => void changePassword()}
          >
            {t('settings.updatePassword')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
