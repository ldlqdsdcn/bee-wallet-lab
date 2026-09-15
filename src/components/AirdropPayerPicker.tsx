import { useEffect, useMemo, useState } from 'react'
import type { AccountRecord, HdKeyRecord, NetworkScope, WalletType } from '@shared/types'
import { accountApi, portfolioApi } from '../lib/bridge'
import { matchAddressKeyword, matchBalanceRange, uniquePayersByAddress } from '../lib/airdropPayer'
import { formatAmount, shorten } from '../lib/format'
import { useT } from '../i18n'
import { Button, Field, Modal } from './ui'

export interface AirdropPayer {
  accountId: string
  hdKeyId: string | null
  address: string
  label: string
}

const PAGE_SIZE = 20

export function AirdropPayerPicker({
  walletId,
  accountId,
  walletType,
  networkScope,
  networkPk,
  tokenPk,
  tokenSymbol,
  label,
  payer,
  onSelect,
}: {
  walletId: string
  accountId: string
  walletType: WalletType
  networkScope?: NetworkScope
  networkPk: string
  tokenPk: string
  tokenSymbol: string
  label?: string
  payer: AirdropPayer | null
  onSelect: (payer: AirdropPayer) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [minBalance, setMinBalance] = useState('')
  const [maxBalance, setMaxBalance] = useState('')
  const [page, setPage] = useState(1)
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [hdKeys, setHdKeys] = useState<HdKeyRecord[]>([])
  const [balances, setBalances] = useState<Record<string, string | null>>({})
  const [loadingList, setLoadingList] = useState(false)
  const [loadingBalances, setLoadingBalances] = useState(false)

  const fieldLabel = label ?? t('airdrop.fromAccount')

  useEffect(() => {
    if (!open || !walletId) return
    let alive = true
    setLoadingList(true)
    void Promise.all([
      accountApi.list(walletId),
      accountApi.hdKeyList({
        walletId,
        walletType,
        ...(walletType === 'bitcoin' ? { networkScope } : {}),
      }),
    ])
      .then(([accountRows, keys]) => {
        if (!alive) return
        setAccounts(
          accountRows.filter((item) => {
            if (item.walletType !== walletType) return false
            if (walletType === 'bitcoin') return item.networkScope === networkScope
            return true
          }),
        )
        setHdKeys(keys)
      })
      .catch(() => {
        if (!alive) return
        setAccounts([])
        setHdKeys([])
      })
      .finally(() => {
        if (alive) setLoadingList(false)
      })
    return () => {
      alive = false
    }
  }, [open, walletId, walletType, networkScope])

  const rows = useMemo(() => {
    const main = accounts[0]
    const list: AirdropPayer[] = []
    if (main) {
      list.push({
        accountId: main.id,
        hdKeyId: null,
        address: main.address,
        label: t('airdrop.mainAccount'),
      })
    }
    for (const account of accounts.slice(1)) {
      list.push({
        accountId: account.id,
        hdKeyId: null,
        address: account.address,
        label: account.label || account.addressType || account.walletType,
      })
    }
    for (const key of hdKeys) {
      list.push({
        accountId: accountId || main?.id || '',
        hdKeyId: key.id,
        address: key.address,
        label: t('airdrop.hdIndex', { index: key.addressIndex }),
      })
    }
    return uniquePayersByAddress(list)
  }, [accountId, accounts, hdKeys, t])

  useEffect(() => {
    setBalances({})
  }, [networkPk, tokenPk])

  useEffect(() => {
    setPage(1)
  }, [keyword, minBalance, maxBalance, walletId, walletType, networkScope])

  useEffect(() => {
    if (!payer?.address || !networkPk || !tokenPk) return
    let alive = true
    void portfolioApi
      .tokenBalances({ networkPk, tokenPk, addresses: [payer.address] })
      .then((result) => {
        if (!alive) return
        const row = result[0]
        if (!row) return
        setBalances((current) => ({ ...current, [row.address.toLowerCase()]: row.balance }))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [payer?.address, networkPk, tokenPk])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!matchAddressKeyword(row.address, keyword)) return false
      return matchBalanceRange(balances[row.address.toLowerCase()], minBalance, maxBalance)
    })
  }, [balances, keyword, maxBalance, minBalance, rows])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (!open || !networkPk || !tokenPk || paged.length === 0) return
    let alive = true
    const addresses = paged
      .map((row) => row.address)
      .filter((address) => !(address.toLowerCase() in balances))
    if (addresses.length === 0) {
      setLoadingBalances(false)
      return
    }
    setLoadingBalances(true)
    void portfolioApi
      .tokenBalances({ networkPk, tokenPk, addresses })
      .then((result) => {
        if (!alive) return
        setBalances((current) => {
          const next = { ...current }
          for (const item of result) next[item.address.toLowerCase()] = item.balance
          return next
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoadingBalances(false)
      })
    return () => {
      alive = false
    }
  }, [open, networkPk, tokenPk, safePage, paged.map((row) => row.address).join(',')])

  const pick = (row: AirdropPayer) => {
    onSelect(row)
    setOpen(false)
  }

  const selectedBalance = payer ? balances[payer.address.toLowerCase()] : null

  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-ink-400">{fieldLabel}</span>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-left text-sm text-ink-200 outline-none hover:border-honey-500 focus:border-honey-500"
        onClick={() => setOpen(true)}
      >
        {payer ? (
          <span className="min-w-0">
            <span className="block truncate">
              {payer.label} · {shorten(payer.address, 8, 6)}
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-500">
              {selectedBalance != null
                ? t('common.balance', { amount: formatAmount(selectedBalance), symbol: tokenSymbol })
                : t('airdrop.fromHint')}
            </span>
          </span>
        ) : (
          <span className="text-ink-500">{t('airdrop.pickAccount')}</span>
        )}
        <span className="shrink-0 text-xs text-honey-400">{t('common.select')}</span>
      </button>

      {open ? (
        <Modal title={t('airdrop.pickAccount')} onClose={() => setOpen(false)} className="max-w-2xl">
          <div className="mt-3 space-y-3">
            <Field
              label={t('airdrop.filterAddress')}
              value={keyword}
              placeholder={t('airdrop.filterAddressPh')}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('airdrop.balanceMin')}
                value={minBalance}
                placeholder="0"
                onChange={(e) => setMinBalance(e.target.value)}
              />
              <Field
                label={t('airdrop.balanceMax')}
                value={maxBalance}
                placeholder="1000"
                onChange={(e) => setMaxBalance(e.target.value)}
              />
            </div>
            {loadingList || loadingBalances ? (
              <p className="text-[11px] text-ink-500">{t('airdrop.balanceLoading')}</p>
            ) : null}
            <ul className="max-h-80 divide-y divide-ink-800 overflow-y-auto rounded-lg border border-ink-700">
              {paged.length === 0 ? (
                <li className="px-3 py-4 text-sm text-ink-400">{t('airdrop.payerEmpty')}</li>
              ) : (
                paged.map((row) => {
                  const balance = balances[row.address.toLowerCase()]
                  const active = payer?.address.toLowerCase() === row.address.toLowerCase()
                  return (
                    <li key={`${row.hdKeyId ?? row.accountId}:${row.address.toLowerCase()}`}>
                      <button
                        type="button"
                        className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left ${
                          active ? 'bg-ink-800 text-honey-400' : 'text-ink-200 hover:bg-ink-800'
                        }`}
                        onClick={() => pick(row)}
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-medium">{row.label}</span>
                          <span className="sensitive mt-0.5 block truncate font-mono text-[11px] text-ink-400">
                            {row.address}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-300">
                          {balance != null ? `${formatAmount(balance)} ${tokenSymbol}` : '…'}
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
              <span>
                {t('hd.pageRange', {
                  from: filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
                  to: Math.min(safePage * PAGE_SIZE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
                  disabled={safePage <= 1}
                  onClick={() => setPage(safePage - 1)}
                >
                  {t('common.prev')}
                </button>
                <span>
                  {safePage} / {pageCount}
                </span>
                <button
                  type="button"
                  className="rounded px-2 py-1 hover:bg-ink-800 disabled:opacity-40"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage(safePage + 1)}
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
