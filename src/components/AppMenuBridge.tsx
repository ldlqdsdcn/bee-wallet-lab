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

function workspaceNote(kind: 'new' | 'import' | 'export'): { title: string; body: string } {
  if (kind === 'new') {
    return {
      title: '新建工作区',
      body: '第一版暂未开放。后续会做成独立工作区文件，避免和新钱包数据混在一起。',
    }
  }
  if (kind === 'import') {
    return {
      title: '导入工作区',
      body: '第一版暂未开放。后续会支持导入已导出的工作区备份。',
    }
  }
  return {
    title: '导出工作区',
    body: '第一版暂未开放。后续会把钱包目录（不含明文助记词）导出成备份包。',
  }
}

export function AppMenuBridge() {
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
        setWorkspace(workspaceNote(command.kind))
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
  }, [lock, navigate, openPicker, selectNetwork])

  if (!workspace) return null

  return (
    <Modal title={workspace.title} onClose={() => setWorkspace(null)}>
      <p className="mt-3 text-sm text-ink-400">{workspace.body}</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => setWorkspace(null)}>知道了</Button>
      </div>
    </Modal>
  )
}
