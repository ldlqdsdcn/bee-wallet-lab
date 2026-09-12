import { useEffect, useMemo, useState } from 'react'
import type { AssetEntry } from '@shared/types'
import { portfolioApi } from './bridge'

export function useAccountBalances(accountId: string, networkPk: string) {
  const [entries, setEntries] = useState<AssetEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!accountId || !networkPk) {
      setEntries([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void portfolioApi
      .account(accountId, networkPk)
      .then((rows) => {
        if (alive) setEntries(rows)
      })
      .catch(() => {
        if (alive) setEntries([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [accountId, networkPk, tick])

  const byToken = useMemo(() => {
    const map: Record<string, string> = {}
    for (const entry of entries) map[entry.tokenPk] = entry.balance
    return map
  }, [entries])

  return {
    entries,
    byToken,
    loading,
    reload: () => setTick((n) => n + 1),
    of: (tokenPk: string) => (tokenPk ? (byToken[tokenPk] ?? null) : null),
  }
}
