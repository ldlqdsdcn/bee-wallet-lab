import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import LockScreen from './pages/LockScreen'
import SettingsPage from './pages/SettingsPage'
import AddressBookPage from './pages/AddressBookPage'
import HomePage from './pages/HomePage'
import WalletsPage from './pages/WalletsPage'
import HdDerivePage from './pages/HdDerivePage'
import TransferPage from './pages/TransferPage'
import SwapPage from './pages/SwapPage'
import BridgePage from './pages/BridgePage'
import TxLabPage from './pages/TxLabPage'
import AbiToolsPage from './pages/AbiToolsPage'
import ContractPage from './pages/ContractPage'
import DevToolsPage from './pages/DevToolsPage'
import IssuePage from './pages/IssuePage'
import HdAirdropPage from './pages/HdAirdropPage'
import ActivityPage from './pages/ActivityPage'
import SignPage from './pages/SignPage'
import RpcNodesPage from './pages/RpcNodesPage'
import NetworksPage from './pages/NetworksPage'
import TokensPage from './pages/TokensPage'
import FaucetsPage from './pages/FaucetsPage'
import DappsPage from './pages/DappsPage'
import WalletConnectPage from './pages/WalletConnectPage'
import ProxyPage from './pages/ProxyPage'
import { subscribeVaultEvents, useVaultStore } from './store/vaultStore'
import { subscribeWalletEvents } from './store/walletStore'
import { subscribeNetworkEvents } from './store/networkStore'
import { subscribeAddressBookEvents } from './store/addressBookStore'
import { useBrowserStore } from './store/browserStore'
import { BrowserChrome } from './components/BrowserChrome'
import { useT } from './i18n'
import { normalizeLocale } from '@shared/locale'

export default function App() {
  const status = useVaultStore((s) => s.status)
  const loading = useVaultStore((s) => s.loading)
  const error = useVaultStore((s) => s.error)
  const bootstrap = useVaultStore((s) => s.bootstrap)
  const language = useVaultStore((s) => s.settings?.language)
  const t = useT()

  useEffect(() => {
    void bootstrap()
    const offVault = subscribeVaultEvents()
    const offWallets = subscribeWalletEvents()
    const offNetworks = subscribeNetworkEvents()
    const offAddressBook = subscribeAddressBookEvents()
    return () => {
      offVault()
      offWallets()
      offNetworks()
      offAddressBook()
    }
  }, [bootstrap])

  useEffect(() => {
    if (!status?.unlocked) useBrowserStore.getState().closeAll()
  }, [status?.unlocked])

  useEffect(() => {
    document.documentElement.lang = normalizeLocale(language)
  }, [language])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-400">{t('common.loading')}</div>
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-300">
        {error ?? t('common.noBridge')}
      </div>
    )
  }

  if (!status.unlocked) return <LockScreen />

  return (
    <HashRouter>
      <BrowserChrome>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="wallets" element={<WalletsPage />} />
            <Route path="hd" element={<HdDerivePage />} />
            <Route path="transfer" element={<TransferPage />} />
            <Route path="swap" element={<SwapPage />} />
            <Route path="bridge" element={<BridgePage />} />
            <Route path="tx-lab" element={<TxLabPage />} />
            <Route path="abi" element={<AbiToolsPage />} />
            <Route path="contract" element={<ContractPage />} />
            <Route path="dev-tools" element={<DevToolsPage />} />
            <Route path="issue" element={<IssuePage />} />
            <Route path="hd-airdrop" element={<HdAirdropPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="address-book" element={<AddressBookPage />} />
            <Route path="sign" element={<SignPage />} />
            <Route path="nodes" element={<RpcNodesPage />} />
            <Route path="networks" element={<NetworksPage />} />
            <Route path="tokens" element={<TokensPage />} />
            <Route path="faucets" element={<FaucetsPage />} />
            <Route path="dapps/:category" element={<DappsPage />} />
            <Route path="dapps" element={<DappsPage />} />
            <Route path="wallet-connect" element={<WalletConnectPage />} />
            <Route path="proxy" element={<ProxyPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserChrome>
    </HashRouter>
  )
}
