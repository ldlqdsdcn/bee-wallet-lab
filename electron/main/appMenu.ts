/**
 * 替换 Electron 默认菜单。锁定时只保留退出与帮助。
 */
import { Menu, app, dialog, type MenuItemConstructorOptions } from 'electron'
import { IPC_EVENT, type AppCommand } from '../../shared/ipc'
import { DAPP_CATEGORIES } from '../../shared/dapps'
import { broadcast } from './ipc/registry'
import { getStatus, onVaultEvent } from './security/vault'
import { requestQuit } from './quit'

function send(command: AppCommand): void {
  broadcast(IPC_EVENT.appCommand, command)
}

function navigate(path: string, state?: Record<string, unknown>): void {
  send({ action: 'navigate', path, state })
}

async function showAbout(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '关于 Bee Wallet Lab',
    message: 'Bee Wallet Lab',
    detail: `版本 ${app.getVersion()}\n本地优先的多链实验钱包。助记词只留在主进程。`,
  })
}

async function showCheckUpdates(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: '当前是开发版',
    detail: '第一版尚未接入自动更新。请从 GitHub 仓库自行拉取最新代码。',
  })
}

function unlockedTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: '文件',
      submenu: [
        { label: '新建工作区', click: () => send({ action: 'workspace', kind: 'new' }) },
        { label: '导入工作区', click: () => send({ action: 'workspace', kind: 'import' }) },
        { label: '导出工作区', click: () => send({ action: 'workspace', kind: 'export' }) },
        { type: 'separator' },
        { label: '锁定', accelerator: 'CommandOrControl+L', click: () => send({ action: 'lock' }) },
        { type: 'separator' },
        { label: '退出', accelerator: 'CommandOrControl+Q', click: () => void requestQuit() },
      ],
    },
    {
      label: '钱包',
      submenu: [
        { label: '新建钱包', click: () => navigate('/wallets', { wizard: 'create' }) },
        { label: '导入钱包', click: () => navigate('/wallets', { wizard: 'import' }) },
        { label: '钱包备份', click: () => navigate('/wallets', { backup: true }) },
        { label: '分层钱包', click: () => navigate('/hd') },
      ],
    },
    {
      label: '网络',
      submenu: [
        { label: '节点维护', click: () => navigate('/nodes') },
        { label: '网络维护', click: () => navigate('/networks') },
        { label: '代币维护', click: () => navigate('/tokens') },
        { label: '代理', click: () => navigate('/proxy') },
        { type: 'separator' },
        { label: '切换网络', click: () => send({ action: 'switchNetwork' }) },
        { label: '水龙头', click: () => navigate('/faucets') },
      ],
    },
    {
      label: '设置',
      submenu: [
        {
          label: '打开设置',
          accelerator: 'CommandOrControl+,',
          click: () => navigate('/settings'),
        },
      ],
    },
    {
      label: '工具',
      submenu: [
        { label: '收款转账', click: () => navigate('/transfer') },
        { label: '交易实验室', click: () => navigate('/tx-lab') },
        { label: 'ABI 工具', click: () => navigate('/abi') },
        { label: '发行代币', click: () => navigate('/issue') },
        { label: '批量转账', click: () => navigate('/hd-airdrop') },
        { label: '交易记录', click: () => navigate('/activity') },
        { label: '地址簿', click: () => navigate('/address-book') },
        { label: '消息签名', click: () => navigate('/sign') },
        { type: 'separator' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '三方连接',
      submenu: DAPP_CATEGORIES.map((item) => ({
        label: item.label,
        click: () => navigate(`/dapps/${item.id}`),
      })),
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => void showAbout() },
        { label: '检查更新', click: () => void showCheckUpdates() },
      ],
    },
  ]
}

function lockedTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: '文件',
      submenu: [{ label: '退出', accelerator: 'CommandOrControl+Q', click: () => void requestQuit() }],
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => void showAbout() },
        { label: '检查更新', click: () => void showCheckUpdates() },
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
