import { useEffect, useState } from 'react'
import { useVaultStore } from '../store/vaultStore'
import { Alert, Button, Field } from '../components/ui'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { useT } from '../i18n'
import logoUrl from '../assets/logo.png'

/**
 * 锁屏：未初始化时设置主密码，已初始化时解锁。
 * 主密码只在本组件内短暂存在于 state，提交后立即清空。
 */
export default function LockScreen() {
  const t = useT()
  const status = useVaultStore((s) => s.status)
  const error = useVaultStore((s) => s.error)
  const initialize = useVaultStore((s) => s.initialize)
  const unlock = useVaultStore((s) => s.unlock)
  const clearError = useVaultStore((s) => s.clearError)

  const needsSetup = status?.initialized === false
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(0)

  // 惩罚延迟倒计时
  useEffect(() => {
    const until = status?.lockoutUntil ?? 0
    if (!until) {
      setCountdown(0)
      return
    }
    const tick = () => setCountdown(Math.max(0, Math.ceil((until - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [status?.lockoutUntil])

  const submit = async () => {
    setBusy(true)
    try {
      if (needsSetup) await initialize(password, confirm)
      else await unlock(password)
    } finally {
      setPassword('')
      setConfirm('')
      setBusy(false)
    }
  }

  const disabled = busy || password.length === 0 || countdown > 0

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <img src={logoUrl} alt="Bee Wallet Lab" className="mx-auto mb-3 h-20 w-20 select-none" draggable={false} />
          <h1 className="text-lg font-semibold text-ink-200">Bee Wallet Lab</h1>
          <p className="mt-1 text-xs text-ink-400">
            {needsSetup ? t('lock.setupHint') : t('lock.unlockHint')}
          </p>
        </div>

        <LanguageSwitch />

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!disabled) void submit()
          }}
        >
          <Field
            label={t('lock.password')}
            type="password"
            autoFocus
            autoComplete="off"
            value={password}
            placeholder={needsSetup ? t('lock.placeholder') : ''}
            onChange={(e) => {
              clearError()
              setPassword(e.target.value)
            }}
          />
          {needsSetup ? (
            <Field
              label={t('lock.confirm')}
              type="password"
              autoComplete="off"
              value={confirm}
              onChange={(e) => {
                clearError()
                setConfirm(e.target.value)
              }}
            />
          ) : null}

          <Alert>{error}</Alert>

          <Button type="submit" className="w-full" disabled={disabled}>
            {countdown > 0
              ? t('lock.wait', { seconds: countdown })
              : needsSetup
                ? t('lock.setup')
                : t('lock.unlock')}
          </Button>
        </form>

        {needsSetup ? (
          <p className="text-center text-xs leading-relaxed text-ink-600">{t('lock.forget')}</p>
        ) : status && status.failedAttempts > 0 ? (
          <p className="text-center text-xs text-ink-600">{t('lock.failed', { count: status.failedAttempts })}</p>
        ) : null}
      </div>
    </div>
  )
}
