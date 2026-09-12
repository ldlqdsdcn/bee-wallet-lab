import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { DappCatalog } from '@shared/types'
import { DAPP_HOT_CATEGORY_ID, dappCategoryById, dappsInCategory, defaultDappCategoryId } from '@shared/dapps'
import { dappApi, settingsApi } from '../lib/bridge'
import { Alert, Button, Card } from '../components/ui'
import { explorerTabTitle } from '../lib/explorer'
import { useBrowserStore } from '../store/browserStore'
import { useT } from '../i18n'

export default function DappsPage() {
  const t = useT()
  const navigate = useNavigate()
  const open = useBrowserStore((s) => s.open)
  const { category: raw } = useParams<{ category: string }>()
  const [catalog, setCatalog] = useState<DappCatalog | null>(null)
  const [catalogReady, setCatalogReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = (force = false) => {
    let alive = true
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const settings = await settingsApi.get()
        if (!alive) return
        const ready = Boolean(settings.baseUrl.trim())
        setCatalogReady(ready)
        if (!ready) {
          setCatalog(null)
          return
        }
        const next = await dappApi.catalog(force)
        if (!alive) return
        setCatalog(next)
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }

  useEffect(() => load(), [])

  const category = useMemo(() => {
    if (!catalog) return undefined
    const fallback = defaultDappCategoryId(catalog)
    return dappCategoryById(catalog, raw || fallback || '')
  }, [catalog, raw])

  const rows = catalog && category ? dappsInCategory(catalog, category.id) : []

  useEffect(() => {
    if (!catalog || raw) return
    const first = defaultDappCategoryId(catalog)
    if (first) navigate(`/dapps/${first}`, { replace: true })
  }, [catalog, raw, navigate])

  const categoryLabel = category
    ? category.virtual || category.id === DAPP_HOT_CATEGORY_ID
      ? t('dapp.hot')
      : category.name
    : ''

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-ink-200">{t('dapp.title')}</h1>
        <p className="mt-1 text-xs text-ink-500">{t('dapp.subtitle')}</p>
      </div>

      {!catalogReady && !loading ? (
        <Card>
          <p className="text-sm text-ink-300">{t('dapp.needCatalog')}</p>
          <Button className="mt-3" onClick={() => navigate('/settings')}>
            {t('dapp.openSettings')}
          </Button>
        </Card>
      ) : null}

      {error ? (
        <Alert>
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => load(true)}>
              {t('dapp.retry')}
            </Button>
          </div>
        </Alert>
      ) : null}

      {catalogReady && catalog ? (
        <>
          <div className="flex flex-wrap gap-2">
            {catalog.categories.map((item) => (
              <Button
                key={item.id}
                variant={item.id === category?.id ? 'primary' : 'ghost'}
                className="px-3 py-1 text-xs"
                onClick={() => navigate(`/dapps/${item.id}`)}
              >
                {item.virtual || item.id === DAPP_HOT_CATEGORY_ID ? t('dapp.hot') : item.name}
              </Button>
            ))}
          </div>

          {!category ? (
            <p className="text-sm text-ink-400">{loading ? t('common.loading') : t('dapp.pick')}</p>
          ) : (
            <Card
              title={t('dapp.count', { label: categoryLabel, count: rows.length })}
              action={
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => load(true)}>
                  {t('dapp.refresh')}
                </Button>
              }
            >
              {loading ? (
                <p className="text-sm text-ink-400">{t('common.loading')}</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-ink-400">{t('dapp.empty')}</p>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {rows.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-3">
                      {item.icon ? (
                        <img src={item.icon} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-700 text-xs text-ink-400">
                          {item.name.slice(0, 1)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-200">{item.name}</p>
                        {item.remark ? <p className="text-[11px] text-ink-500">{item.remark}</p> : null}
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
        </>
      ) : null}

      {catalogReady && loading && !catalog ? (
        <p className="text-sm text-ink-400">{t('common.loading')}</p>
      ) : null}
    </div>
  )
}
