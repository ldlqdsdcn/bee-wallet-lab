import path from 'node:path'
import { app, dialog, shell, type MenuItemConstructorOptions } from 'electron'
import { t } from '../i18n'
import { restartApp } from '../quit'
import { isUnlocked } from '../security/vault'
import { createWorkspace, exportWorkspace, importWorkspace, validateWorkspace } from './files'
import { getWorkspaceDirectory, selectWorkspace } from './state'
import { seedEnvironment } from './environment'

let busy = false

async function run(action: () => Promise<void>): Promise<void> {
  if (busy) return
  busy = true
  try { await action() } catch (error) {
    await dialog.showMessageBox({ type: 'error', title: t('workspace.error'), message: t('workspace.error'),
      detail: error instanceof Error ? error.message : String(error) })
  } finally { busy = false }
}

async function chooseDestination(title: string): Promise<string | undefined> {
  // showSaveDialog lets users name a new directory without creating it before validation.
  const result = await dialog.showSaveDialog({ title, buttonLabel: t('workspace.choose'),
    defaultPath: path.join(path.dirname(getWorkspaceDirectory()), 'bee_wallet_workspace_new'),
    properties: ['createDirectory', 'showOverwriteConfirmation'] })
  return result.canceled ? undefined : result.filePath
}

async function confirmSwitch(directory: string): Promise<boolean> {
  const result = await dialog.showMessageBox({ type: 'question', title: t('workspace.switch'),
    message: t('workspace.restart'), detail: directory, buttons: [t('workspace.cancel'), t('workspace.switch')],
    defaultId: 0, cancelId: 0 })
  return result.response === 1
}

function switchTo(directory: string): void {
  selectWorkspace(directory)
  restartApp()
}

export function workspaceMenu(): MenuItemConstructorOptions[] {
  return [
    { label: `${t('workspace.current')}: ${path.basename(getWorkspaceDirectory())}`, submenu: [
      { label: getWorkspaceDirectory(), enabled: false },
      { label: t('workspace.reveal'), click: () => { void shell.openPath(getWorkspaceDirectory()) } },
    ] },
    { label: t('workspace.new'), accelerator: 'CommandOrControl+Shift+N', click: () => void run(async () => {
      const destination = await chooseDestination(t('workspace.new'))
      if (!destination) return
      const directory = createWorkspace(destination, seedEnvironment())
      if (await confirmSwitch(directory)) switchTo(directory)
    }) },
    { label: t('workspace.open'), accelerator: 'CommandOrControl+Shift+O', click: () => void run(async () => {
      const result = await dialog.showOpenDialog({ title: t('workspace.open'), properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return
      const directory = result.filePaths[0]
      validateWorkspace(directory)
      if (path.resolve(directory) === getWorkspaceDirectory()) return
      if (await confirmSwitch(directory)) switchTo(directory)
    }) },
    { label: t('workspace.import'), click: () => void run(async () => {
      const result = await dialog.showOpenDialog({ title: t('workspace.import'), properties: ['openFile'],
        filters: [{ name: 'Bee Wallet Workspace', extensions: ['beeworkspace'] }] })
      if (result.canceled || !result.filePaths[0]) return
      const destination = await chooseDestination(t('workspace.importDestination'))
      if (!destination) return
      const directory = importWorkspace(result.filePaths[0], destination)
      if (await confirmSwitch(directory)) switchTo(directory)
    }) },
    { label: t('workspace.export'), enabled: isUnlocked(), click: () => void run(async () => {
      if (!isUnlocked()) throw new Error(t('workspace.unlock'))
      const result = await dialog.showSaveDialog({ title: t('workspace.export'),
        defaultPath: path.join(app.getPath('documents'), `${path.basename(getWorkspaceDirectory())}-${new Date().toISOString().slice(0, 10)}.beeworkspace`),
        filters: [{ name: 'Bee Wallet Workspace', extensions: ['beeworkspace'] }] })
      if (result.canceled || !result.filePath) return
      if (!isUnlocked()) throw new Error(t('workspace.unlock'))
      exportWorkspace(getWorkspaceDirectory(), result.filePath)
      await dialog.showMessageBox({ type: 'info', title: t('workspace.export'), message: t('workspace.exported'),
        detail: `${result.filePath}\n\n${t('workspace.backupDetail')}` })
    }) },
    { type: 'separator' },
  ]
}
