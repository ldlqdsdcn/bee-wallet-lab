/**
 * 替换 Electron 默认菜单。锁定时只保留退出与帮助。
 */
import { Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'
import { IPC_EVENT, type AppCommand } from '../../shared/ipc'
import { navigationGroups, type NavigationGroup } from '../../shared/navigation'
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

function navigationMenu(group: NavigationGroup): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = group.items.map((item) => ({
    label: t(item.key),
    click: () => navigate(item.to),
  }))

  if (group.id === 'wallet') {
    submenu.push(
      { type: 'separator' },
      { label: t('menu.newWallet'), click: () => navigate('/wallets', { wizard: 'create' }) },
      { label: t('menu.importWallet'), click: () => navigate('/wallets', { wizard: 'import' }) },
      { label: t('menu.backup'), click: () => navigate('/wallets', { backup: true }) },
    )
  }
  if (group.id === 'network') {
    submenu.unshift(
      { label: t('network.switch'), click: () => send({ action: 'switchNetwork' }) },
      { type: 'separator' },
    )
  }
  if (group.id === 'apps') {
    const categories = peekDappCategories()
    if (categories.length > 0) {
      submenu.push(
        { type: 'separator' },
        {
          label: t('menu.dappCategories'),
          submenu: categories.map((item) => ({
            label: item.virtual ? t('dapp.hot') : item.name,
            click: () => navigate(`/dapps/${item.id}`),
          })),
        },
      )
    }
  }
  return { label: t(group.menuKey), submenu }
}

function unlockedTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.openSettings'),
          accelerator: 'CommandOrControl+,',
          click: () => navigate('/settings'),
        },
        { type: 'separator' },
        { label: t('menu.lock'), accelerator: 'CommandOrControl+L', click: () => send({ action: 'lock' }) },
        { type: 'separator' },
        { label: t('menu.quit'), accelerator: 'CommandOrControl+Q', click: () => void requestQuit() },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    ...navigationGroups.map(navigationMenu),
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
