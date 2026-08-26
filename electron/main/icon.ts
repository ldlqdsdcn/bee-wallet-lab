/**
 * 应用图标。
 *
 * Linux/GNOME 的启动器（左侧 dock）不看窗口装饰图标，而是用 WM_CLASS 去匹配
 * `.desktop` 文件的 Icon。`npm run dev` 没有安装包，所以要在用户目录写一份
 * 开发用 desktop 入口，否则 Ubuntu 会显示默认齿轮。
 */
import { app, nativeImage, type NativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LINUX_DESKTOP_ID = 'bee-wallet.desktop'
const LINUX_WM_CLASS = 'bee-wallet'

export function resolveAppIconPath(): string {
  const extra = process.env.VITE_PUBLIC
  const candidates = [
    extra ? path.join(extra, 'icon.png') : '',
    path.join(process.env.APP_ROOT ?? '', 'public', 'icon.png'),
    path.join(process.env.APP_ROOT ?? '', 'build', 'icon.png'),
    path.join(app.getAppPath(), 'public', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
  ].filter(Boolean)

  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0]
}

export function loadAppIcon(): NativeImage | undefined {
  const file = resolveAppIconPath()
  if (!file || !fs.existsSync(file)) return undefined
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? undefined : image
}

/** 给 GNOME 启动器一份能对上 WM_CLASS 的图标。打包安装后由 electron-builder 负责。 */
export function ensureLinuxDevDesktopEntry(): void {
  if (process.platform !== 'linux' || app.isPackaged) return

  const icon = resolveAppIconPath()
  if (!icon || !fs.existsSync(icon)) return

  const dir = path.join(os.homedir(), '.local', 'share', 'applications')
  fs.mkdirSync(dir, { recursive: true })

  const body = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Bee Wallet Lab',
    'Comment=Bee Wallet Lab (npm run dev)',
    `Exec=${JSON.stringify(process.execPath)}`,
    `Icon=${icon}`,
    'Terminal=false',
    'Categories=Finance;Utility;',
    `StartupWMClass=${LINUX_WM_CLASS}`,
    'NoDisplay=true',
    '',
  ].join('\n')

  fs.writeFileSync(path.join(dir, LINUX_DESKTOP_ID), body)
}
