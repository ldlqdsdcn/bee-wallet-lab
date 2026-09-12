/**
 * 替换 Electron 默认菜单。锁定时只保留退出与帮助。
 */
import { Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'
import { IPC_EVENT, type AppCommand } from '../../shared/ipc'
import { peekDappCategories } from './dapp/service'
import { broadcast } from './ipc/registry'
import { getStatus, onVaultEvent } from './security/vault'
import { requestQuit } from './quit'
import { t } from './i18n'

function send(command: AppCommand): void {
  broadcast(IPC_EVENT.appCommand, command)
}

function navigate(path: string, state?: Record<string, unknown>): void {
  send({ action: 'navigate', path, state })
}

async function showAbout(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: t('menu.aboutTitle'),
    message: 'Bee Wallet Lab',
    detail: t('menu.aboutDetail', { version: app.getVersion() }),
  })
}

async function showCheckUpdates(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: t('menu.updateTitle'),
    message: t('menu.updateMsg'),
    detail: t('menu.updateDetail'),
  })
}

function unlockedTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newWorkspace'), click: () => send({ action: 'workspace', kind: 'new' }) },
        { label: t('menu.importWorkspace'), click: () => send({ action: 'workspace', kind: 'import' }) },
        { label: t('menu.exportWorkspace'), click: () => send({ action: 'workspace', kind: 'export' }) },
        { type: 'separator' },
        { label: t('menu.lock'), accelerator: 'CommandOrControl+L', click: () => send({ action: 'lock' }) },
        { type: 'separator' },
        { label: t('menu.quit'), accelerator: 'CommandOrControl+Q', click: () => void requestQuit() },
      ],
    },
    {
      label: t('menu.wallet'),
      submenu: [
        { label: t('menu.newWallet'), click: () => navigate('/wallets', { wizard: 'create' }) },
        { label: t('menu.importWallet'), click: () => navigate('/wallets', { wizard: 'import' }) },
        { label: t('menu.backup'), click: () => navigate('/wallets', { backup: true }) },
        { label: t('nav.hd'), click: () => navigate('/hd') },
      ],
    },
    {
      label: t('menu.network'),
      submenu: [
        { label: t('menu.nodes'), click: () => navigate('/nodes') },
        { label: t('menu.networks'), click: () => navigate('/networks') },
        { label: t('menu.tokens'), click: () => navigate('/tokens') },
        { label: t('menu.proxy'), click: () => navigate('/proxy') },
        { type: 'separator' },
        { label: t('network.switch'), click: () => send({ action: 'switchNetwork' }) },
        { label: t('menu.faucets'), click: () => navigate('/faucets') },
      ],
    },
    {
      label: t('menu.settings'),
      submenu: [
        {
          label: t('menu.openSettings'),
          accelerator: 'CommandOrControl+,',
          click: () => navigate('/settings'),
        },
      ],
    },
    {
      label: t('menu.tools'),
      submenu: [
        { label: t('nav.transfer'), click: () => navigate('/transfer') },
        { label: t('nav.swap'), click: () => navigate('/swap') },
        { label: t('nav.bridge'), click: () => navigate('/bridge') },
        { label: t('nav.txLab'), click: () => navigate('/tx-lab') },
        { label: t('nav.abi'), click: () => navigate('/abi') },
        { label: t('nav.contract'), click: () => navigate('/contract') },
        { label: t('nav.devTools'), click: () => navigate('/dev-tools') },
        { label: t('nav.issue'), click: () => navigate('/issue') },
        { label: t('nav.airdrop'), click: () => navigate('/hd-airdrop') },
        { label: t('nav.activity'), click: () => navigate('/activity') },
        { label: t('nav.addressBook'), click: () => navigate('/address-book') },
        { label: t('nav.sign'), click: () => navigate('/sign') },
        { type: 'separator' },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      label: t('menu.dapps'),
      submenu: [
        { label: t('dapp.title'), click: () => navigate('/dapps') },
        { label: t('wc.menu'), click: () => navigate('/wallet-connect') },
        ...peekDappCategories().map((item) => ({
          label: item.virtual ? t('dapp.hot') : item.name,
          click: () => navigate(`/dapps/${item.id}`),
        })),
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.about'), click: () => void showAbout() },
        { label: t('menu.updates'), click: () => void showCheckUpdates() },
      ],
    },
  ]
}

function lockedTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: t('menu.file'),
      submenu: [{ label: t('menu.quit'), accelerator: 'CommandOrControl+Q', click: () => void requestQuit() }],
    },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.about'), click: () => void showAbout() },
        { label: t('menu.updates'), click: () => void showCheckUpdates() },
      ],
    },
  ]
}

export function refreshAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(getStatus().unlocked ? unlockedTemplate() : lockedTemplate()))
}

export function installAppMenu(): void {
  refreshAppMenu()
  onVaultEvent(() => refreshAppMenu())
}
