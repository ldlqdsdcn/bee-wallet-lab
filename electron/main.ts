import { app, BrowserWindow, session, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { bootstrap, shutdown } from './main/bootstrap'
import { installAppMenu } from './main/appMenu'
import { isQuitConfirmed, requestQuit } from './main/quit'
import { ensureLinuxDevDesktopEntry, loadAppIcon, resolveAppIconPath } from './main/icon'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// GNOME 用 WM_CLASS 匹配 .desktop；开发态与 package.json name 对齐
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'bee-wallet')
}

let win: BrowserWindow | null

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** 浏览器标签页的 guest 进程：只允许 https，不继承钱包 preload。 */
function hardenWebviewGuests(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpsUrl(url)) void contents.loadURL(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!isHttpsUrl(url)) event.preventDefault()
    })
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
  })
}

function createWindow() {
  const icon = loadAppIcon()
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 680,
    // Windows / Linux 窗口装饰图标；GNOME 启动器还要靠 .desktop，见 ensureLinuxDevDesktopEntry
    ...(icon ? { icon } : { icon: resolveAppIconPath() }),
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // 钱包安全基线：渲染进程完全沙箱化，不允许触达 Node
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      // 区块链浏览器在窗口内以标签页打开，guest 不走钱包 preload
      webviewTag: true,
      spellcheck: false,
    },
  })

  // 避免白屏闪烁（三平台一致）
  win.once('ready-to-show', () => win?.show())
  if (icon && process.platform === 'linux') {
    win.setIcon(icon)
  }
  win.on('close', (event) => {
    if (isQuitConfirmed()) return
    event.preventDefault()
    void requestQuit()
  })
  win.on('closed', () => {
    win = null
  })

  // 钱包窗口本身不许跳出去；https 外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpsUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 禁止导航到非本地页面，防止 XSS 后跳转钓鱼页
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = VITE_DEV_SERVER_URL ? url.startsWith(VITE_DEV_SERVER_URL) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// 单实例：多开会争抢同一个 SQLite 文件
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else if (app.isReady()) {
      // macOS 关窗后进程仍在，第二次启动需要重建窗口
      createWindow()
    }
  })
}

// Windows / Linux 关掉窗口即退出；macOS 保持驻留，等 Cmd + Q
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

/**
 * 生产环境注入 CSP。
 * 开发环境不注入：Vite / React Refresh 需要内联脚本与 ws 连接。
 */
function applyContentSecurityPolicy() {
  if (VITE_DEV_SERVER_URL) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; " +
            "object-src 'none'; base-uri 'none'; frame-src 'none'",
        ],
      },
    })
  })
}

app.on('before-quit', () => {
  shutdown()
})

app.whenReady().then(() => {
  bootstrap()
  applyContentSecurityPolicy()
  hardenWebviewGuests()
  ensureLinuxDevDesktopEntry()
  installAppMenu()
  createWindow()
})
