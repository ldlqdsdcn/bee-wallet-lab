import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { networkLabel } from '../lib/format'
import { currentNetworkOf, useNetworkStore } from '../store/networkStore'
import { NetworkIcon } from './NetworkSelect'
import { useT } from '../i18n'

export function CurrentNetwork() {
  const t = useT()
  const navigate = useNavigate()
  const networks = useNetworkStore((s) => s.networks)
  const currentPk = useNetworkStore((s) => s.currentPk)
  const loading = useNetworkStore((s) => s.loading)
  const load = useNetworkStore((s) => s.load)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const current = currentNetworkOf({ networks, currentPk })

  useEffect(() => {
    void load()
  }, [load])

  if (!current && !loading) {
    return (
      <button
        type="button"
        className="w-full rounded-lg border border-dashed border-ink-600 px-3 py-2 text-left text-xs text-ink-500 hover:border-honey-500 hover:text-honey-400"
        onClick={() => navigate('/networks')}
      >
        {t('network.syncHint')}
      </button>
    )
  }

  return (
    <div>
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-600">{t('network.current')}</span>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-left hover:border-honey-500"
        onClick={openPicker}
      >
        <NetworkIcon src={current?.icon} name={current?.networkName} size={18} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-200">
          {current ? networkLabel(current) : loading ? t('common.loading') : t('network.select')}
        </span>
        {current?.networkScope === 'testnet' ? (
          <span className="shrink-0 text-[10px] text-ink-600">{t('common.testShort')}</span>
        ) : null}
        <span className="shrink-0 text-[10px] text-ink-500">{t('common.switch')}</span>
      </button>
    </div>
  )
}
