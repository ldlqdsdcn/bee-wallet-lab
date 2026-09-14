/**
 * 把原生菜单命令接到路由、锁屏和网络切换。
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC_EVENT, type AppCommand } from '@shared/ipc'
import { on } from '../lib/bridge'
import { useVaultStore } from '../store/vaultStore'
import { useNetworkStore } from '../store/networkStore'

export function AppMenuBridge() {
  const navigate = useNavigate()
  const lock = useVaultStore((s) => s.lock)
  const openPicker = useNetworkStore((s) => s.openPicker)
  const selectNetwork = useNetworkStore((s) => s.select)

  useEffect(() => {
    return on(IPC_EVENT.appCommand, (payload) => {
      const command = payload as AppCommand
      if (command.action === 'lock') {
        void lock()
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

  return null
}
