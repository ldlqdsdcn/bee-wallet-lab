import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import LockScreen from './pages/LockScreen'
import SettingsPage from './pages/SettingsPage'
import AddressBookPage from './pages/AddressBookPage'
import HomePage from './pages/HomePage'
import WalletsPage from './pages/WalletsPage'
import TransferPage from './pages/TransferPage'
import ActivityPage from './pages/ActivityPage'
import SignPage from './pages/SignPage'
import RpcNodesPage from './pages/RpcNodesPage'
import NetworksPage from './pages/NetworksPage'
import TokensPage from './pages/TokensPage'
import FaucetsPage from './pages/FaucetsPage'
import ProxyPage from './pages/ProxyPage'
import { subscribeVaultEvents, useVaultStore } from './store/vaultStore'
import { subscribeWalletEvents } from './store/walletStore'
import { subscribeAddressBookEvents } from './store/addressBookStore'
import { useBrowserStore } from './store/browserStore'
import { BrowserChrome } from './components/BrowserChrome'

export default function App() {
  const status = useVaultStore((s) => s.status)
  const loading = useVaultStore((s) => s.loading)
  const error = useVaultStore((s) => s.error)
  const bootstrap = useVaultStore((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap()
    const offVault = subscribeVaultEvents()
    const offWallets = subscribeWalletEvents()
    const offAddressBook = subscribeAddressBookEvents()
    return () => {
      offVault()
      offWallets()
      offAddressBook()
    }
  }, [bootstrap])

  useEffect(() => {
    if (!status?.unlocked) useBrowserStore.getState().closeAll()
  }, [status?.unlocked])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-400">加载中…</div>
  }

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-300">
        {error ?? '无法连接主进程'}
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
            <Route path="transfer" element={<TransferPage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="address-book" element={<AddressBookPage />} />
            <Route path="sign" element={<SignPage />} />
            <Route path="nodes" element={<RpcNodesPage />} />
            <Route path="networks" element={<NetworksPage />} />
            <Route path="tokens" element={<TokensPage />} />
            <Route path="faucets" element={<FaucetsPage />} />
            <Route path="proxy" element={<ProxyPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserChrome>
    </HashRouter>
  )
}
