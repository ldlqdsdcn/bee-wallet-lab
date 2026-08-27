import { useEffect, useState } from 'react'
import type { CurrencyRecord } from '@shared/types'
import { useVaultStore } from '../store/vaultStore'
import { catalogApi, vaultApi } from '../lib/bridge'
import { Alert, Button, Card, Field, Select } from '../components/ui'

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 0]

export default function SettingsPage() {
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
      setError('两次输入的新主密码不一致')
      return
    }
    try {
      await vaultApi.changePassword(oldPassword, newPassword)
      setMessage('主密码已更新')
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
      <h1 className="text-lg font-semibold text-ink-200">设置</h1>
      <Alert>{error}</Alert>
      {message ? <p className="text-xs text-honey-400">{message}</p> : null}

      <Card title="网络与代币">
        <div className="space-y-3">
          <p className="text-xs text-ink-400">
            第一版目录打包在应用内（Bitcoin / Ethereum / Arbitrum / TRON / BSC / Solana），同步时写入本地数据库，不请求后台。
          </p>
          <Button
            variant="ghost"
            onClick={() =>
              void catalogApi
                .sync(true)
                .then((result) =>
                  setMessage(
                    `已装入 ${result.networks} 个网络 / ${result.tokens} 个代币 / ${result.currencies} 种法币`,
                  ),
                )
                .then(() => catalogApi.currencies().then(setCurrencies))
                .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            }
          >
            重新装入本地目录
          </Button>
          <Field
            label="目录站地址（预留）"
            value={baseUrl}
            hint="以后你的网站做好再填。当前版本不会用这个地址拉数据。"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <Button
            disabled={baseUrl === (settings?.baseUrl ?? '')}
            onClick={() => void updateSettings({ baseUrl: baseUrl.replace(/\/+$/, '') })}
          >
            保存
          </Button>
        </div>
      </Card>

      <Card title="法币">
        <Select
          label="计价货币"
          value={settings?.currencyCode ?? 'USD'}
          onChange={(e) => void updateSettings({ currencyCode: e.target.value })}
        >
          {(currencies.length ? currencies : [{ id: 'usd', code: 'USD', name: 'USD', symbol: '$', syncedAt: 0 }]).map(
            (item) => (
              <option key={item.id} value={item.code}>
                {item.code} {item.name ? `· ${item.name}` : ''}
              </option>
            ),
          )}
        </Select>
      </Card>

      <Card title="自动锁定">
        <div className="flex flex-wrap gap-2">
          {AUTO_LOCK_OPTIONS.map((minutes) => (
            <Button
              key={minutes}
              variant={settings?.autoLockMinutes === minutes ? 'primary' : 'ghost'}
              onClick={() => void updateSettings({ autoLockMinutes: minutes })}
            >
              {minutes === 0 ? '不自动锁定' : `${minutes} 分钟`}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="修改主密码">
        <div className="space-y-3">
          <Field
            label="当前主密码"
            type="password"
            autoComplete="off"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
          />
          <Field
            label="新主密码"
            type="password"
            autoComplete="off"
            value={newPassword}
            hint="至少 8 位，含字母与数字。修改后所有密文会用新密钥重新加密。"
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Field
            label="确认新主密码"
            type="password"
            autoComplete="off"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <Button
            disabled={!oldPassword || !newPassword}
            onClick={() => void changePassword()}
          >
            更新主密码
          </Button>
        </div>
      </Card>
    </div>
  )
}
