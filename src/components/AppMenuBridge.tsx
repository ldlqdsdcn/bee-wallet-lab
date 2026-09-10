/**
 * 把原生菜单命令接到路由、锁屏和工作区说明。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC_EVENT, type AppCommand } from '@shared/ipc'
import { on } from '../lib/bridge'
import { useVaultStore } from '../store/vaultStore'
import { useNetworkStore } from '../store/networkStore'
import { Button, Modal } from './ui'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'

function workspaceNote(
  kind: 'new' | 'import' | 'export',
  t: (key: MessageKey) => string,
): { title: string; body: string } {
  if (kind === 'new') {
    return { title: t('workspace.newTitle'), body: t('workspace.newBody') }
  }
  if (kind === 'import') {
    return { title: t('workspace.importTitle'), body: t('workspace.importBody') }
  }
  return { title: t('workspace.exportTitle'), body: t('workspace.exportBody') }
}

export function AppMenuBridge() {
  const t = useT()
  const navigate = useNavigate()
  const lock = useVaultStore((s) => s.lock)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const selectNetwork = useNetworkStore((s) => s.select)
  const [workspace, setWorkspace] = useState<{ title: string; body: string } | null>(null)

  useEffect(() => {
    return on(IPC_EVENT.appCommand, (payload) => {
      const command = payload as AppCommand
      if (command.action === 'lock') {
        void lock()
        return
      }
      if (command.action === 'workspace') {
        setWorkspace(workspaceNote(command.kind, t))
        return
      }
      if (command.action === 'switchNetwork') {
        openPicker()
        return
      }
      if (command.action === 'navigate') {
        const networkPk = command.state?.networkPk
        if (typeof networkPk === 'string' && networkPk) {
          void selectNetwork(networkPk)
        }
        navigate(command.path, { state: command.state })
      }
    })
  }, [lock, navigate, openPicker, selectNetwork, t])

  if (!workspace) return null

  return (
    <Modal title={workspace.title} onClose={() => setWorkspace(null)}>
      <p className="mt-3 text-sm text-ink-400">{workspace.body}</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => setWorkspace(null)}>{t('common.ok')}</Button>
      </div>
    </Modal>
  )
}
