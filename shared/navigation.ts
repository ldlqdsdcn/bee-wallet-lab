import type { MessageKey } from './i18n'

export interface NavigationGroup {
  id: 'assets' | 'wallet' | 'apps' | 'developer' | 'network'
  key: MessageKey
  menuKey: MessageKey
  items: { to: string; key: MessageKey }[]
}

/** 左侧导航与原生菜单共用分类，保证同一功能在两处都容易找到。 */
export const navigationGroups: NavigationGroup[] = [
  {
    id: 'assets', key: 'nav.group.assets', menuKey: 'menu.transactions',
    items: [
      { to: '/', key: 'nav.home' },
      { to: '/transfer', key: 'nav.transfer' },
      { to: '/swap', key: 'nav.swap' },
      { to: '/bridge', key: 'nav.bridge' },
      { to: '/hd-airdrop', key: 'nav.airdrop' },
      { to: '/activity', key: 'nav.activity' },
    ],
  },
  {
    id: 'wallet', key: 'nav.group.wallet', menuKey: 'menu.wallet',
    items: [
      { to: '/wallets', key: 'nav.wallets' },
      { to: '/hd', key: 'nav.hd' },
      { to: '/address-book', key: 'nav.addressBook' },
    ],
  },
  {
    id: 'apps', key: 'nav.group.apps', menuKey: 'menu.dapps',
    items: [
      { to: '/dapps', key: 'nav.dapps' },
      { to: '/wallet-connect', key: 'nav.walletConnect' },
    ],
  },
  {
    id: 'developer', key: 'nav.group.developer', menuKey: 'menu.developer',
    items: [
      { to: '/contract', key: 'nav.contract' },
      { to: '/tx-lab', key: 'nav.txLab' },
      { to: '/abi', key: 'nav.abi' },
      { to: '/sign', key: 'nav.sign' },
      { to: '/dev-tools', key: 'nav.devTools' },
      { to: '/issue', key: 'nav.issue' },
    ],
  },
  {
    id: 'network', key: 'nav.group.network', menuKey: 'menu.network',
    items: [
      { to: '/networks', key: 'menu.networks' },
      { to: '/nodes', key: 'menu.nodes' },
      { to: '/tokens', key: 'menu.tokens' },
      { to: '/proxy', key: 'menu.proxy' },
      { to: '/faucets', key: 'menu.faucets' },
    ],
  },
]
