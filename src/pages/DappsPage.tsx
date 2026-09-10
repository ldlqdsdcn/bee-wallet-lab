import { useNavigate, useParams } from 'react-router-dom'
import { DAPP_CATEGORIES, dappCategoryById, dappsInCategory } from '@shared/dapps'
import { Button, Card } from '../components/ui'
import { explorerTabTitle } from '../lib/explorer'
import { useBrowserStore } from '../store/browserStore'
import { useT, type MessageKey } from '../i18n'

export default function DappsPage() {
  const t = useT()
  const navigate = useNavigate()
  const open = useBrowserStore((s) => s.open)
  const { category: raw } = useParams<{ category: string }>()
  const category = dappCategoryById(raw || 'hot')
  const rows = category ? dappsInCategory(category.id) : []

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('dapp.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">{t('dapp.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DAPP_CATEGORIES.map((item) => (
          <Button
            key={item.id}
            variant={item.id === category?.id ? 'primary' : 'ghost'}
            className="px-3 py-1 text-xs"
            onClick={() => navigate(`/dapps/${item.id}`)}
          >
            {t(`dapp.${item.id}` as MessageKey)}
          </Button>
        ))}
      </div>

      {!category ? (
        <p className="text-sm text-ink-400">{t('dapp.pick')}</p>
      ) : (
        <Card title={t('dapp.count', { label: t(`dapp.${category.id}` as MessageKey), count: rows.length })}>
          {rows.length === 0 ? (
            <p className="text-sm text-ink-400">{t('dapp.empty')}</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {rows.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-200">{item.name}</p>
                    <p className="text-[11px] text-ink-500">{t(`dapp.remark.${item.id}` as MessageKey)}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-ink-600">{item.url}</p>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-2 py-1 text-xs"
                    onClick={() => open(item.url, item.name || explorerTabTitle(item.url))}
                  >
                    {t('dapp.open')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}
