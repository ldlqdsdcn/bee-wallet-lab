import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WalletType } from '@shared/types'
import { Button, Field, Modal } from './ui'
import { NetworkIcon } from './NetworkSelect'
import { networkLabel } from '../lib/format'
import { useNetworkStore } from '../store/networkStore'
import { useT } from '../i18n'

const TYPE_LABEL: Record<WalletType, string> = {
  bitcoin: 'Bitcoin',
  web3: 'EVM',
  tron: 'TRON',
  solana: 'Solana',
}

const TYPE_ORDER: WalletType[] = ['bitcoin', 'web3', 'tron', 'solana']

export function NetworkSwitchDialog({
  onPick,
  onClose,
}: {
  onPick: (networkPk: string) => void
  onClose: () => void
}) {
  const t = useT()
  const navigate = useNavigate()
  const networks = useNetworkStore((s) => s.networks)
  const currentPk = useNetworkStore((s) => s.currentPk)
  const load = useNetworkStore((s) => s.load)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (networks.length === 0) void load()
  }, [networks.length, load])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? networks.filter((item) => {
          const hay = `${item.networkName} ${item.chainName} ${item.chainId} ${item.coinEasy ?? ''}`.toLowerCase()
          return hay.includes(q)
        })
      : networks
    return TYPE_ORDER.map((type) => ({
      type,
      items: matched.filter((item) => item.walletType === type),
    })).filter((group) => group.items.length > 0)
  }, [networks, query])

  return (
    <Modal title={t('network.switch')} onClose={onClose} wide>
      <p className="mt-1 text-xs text-ink-500">{t('network.switchHint')}</p>
      <div className="mt-3">
        <Field
          label={t('common.search')}
          value={query}
          placeholder={t('network.searchPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-ink-700">
        {grouped.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-500">{t('network.noMatch')}</p>
        ) : (
          grouped.map((group) => (
            <div key={group.type} className="border-b border-ink-800 last:border-b-0">
              <p className="sticky top-0 bg-ink-900 px-3 py-1.5 text-[10px] uppercase tracking-wide text-ink-600">
                {TYPE_LABEL[group.type]}
              </p>
              {group.items.map((item) => {
                const active = item.id === currentPk
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      active ? 'bg-ink-700 text-honey-400' : 'text-ink-200 hover:bg-ink-800'
                    }`}
                    onClick={() => onPick(item.id)}
                  >
                    <NetworkIcon src={item.icon} name={item.networkName} />
                    <span className="min-w-0 flex-1 truncate">{networkLabel(item)}</span>
                    {item.networkScope === 'testnet' ? (
                      <span className="shrink-0 text-[10px] text-ink-600">{t('common.testShort')}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => {
            onClose()
            navigate('/networks')
          }}
        >
          {t('network.maintain')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  )
}
