import type { EnergyResources } from '@shared/types'
import { useT } from '../i18n'
import { Button, Card } from './ui'

export function TronResourcesCard({
  resources,
  loading,
  error,
  onRefresh,
}: {
  resources: EnergyResources | null
  loading: boolean
  error?: string | null
  onRefresh?: () => void
}) {
  const t = useT()
  return (
    <Card
      title={t('tron.resources')}
      action={
        onRefresh ? (
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={loading} onClick={onRefresh}>
            {loading ? t('common.loading') : t('home.refresh')}
          </Button>
        ) : null
      }
    >
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {loading && !resources ? (
        <p className="text-sm text-ink-400">{t('common.loading')}</p>
      ) : resources ? (
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-ink-500">{t('tron.energy')}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink-100">
              {t('tron.resourceValue', { left: resources.energyLeft, limit: resources.energyLimit })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-500">{t('tron.bandwidth')}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink-100">
              {t('tron.resourceValue', { left: resources.bandwidthLeft, limit: resources.bandwidthLimit })}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-ink-400">{t('tron.resourcesEmpty')}</p>
      )}
      <p className="mt-3 text-[11px] text-ink-600">{t('tron.resourcesHint')}</p>
    </Card>
  )
}
