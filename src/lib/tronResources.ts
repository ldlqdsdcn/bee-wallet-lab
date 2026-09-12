import { useEffect, useState } from 'react'
import type { EnergyResources } from '@shared/types'
import { energyApi } from './bridge'

export function useTronResources(accountId: string, networkPk: string, enabled: boolean) {
  const [resources, setResources] = useState<EnergyResources | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled || !accountId || !networkPk) {
      setResources(null)
      setError(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    void energyApi
      .resources(accountId, networkPk)
      .then((next) => {
        if (alive) setResources(next)
      })
      .catch((err) => {
        if (alive) {
          setResources(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [accountId, networkPk, enabled, tick])

  return {
    resources,
    loading,
    error,
    reload: () => setTick((n) => n + 1),
  }
}
