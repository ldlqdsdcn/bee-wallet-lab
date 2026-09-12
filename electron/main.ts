import { installWalletConnectWebSocket } from './main/walletconnect/installWs'
import { app, BrowserWindow, protocol, session, shell } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { bootstrap, shutdown } from './main/bootstrap'
import { installAppMenu } from './main/appMenu'
import { isQuitConfirmed, requestQuit } from './main/quit'
import { ensureLinuxDevDesktopEntry, loadAppIcon, resolveAppIconPath } from './main/icon'
import {
  attachWalletConnectCapture,
  findWalletConnectDeepLink,
  installWalletConnectProtocol,
} from './main/walletconnect/browser'
import { acceptWalletConnectDeepLink } from './main/walletconnect/service'

protocol.registerSchemesAsPrivileged(
  ['wc', 'walletconnect', 'bee-wallet'].map((scheme) => ({
    scheme,
    privileges: { secure: true, supportFetchAPI: true, corsEnabled: true },
  })),
)

installWalletConnectWebSocket()

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

const CLIPBOARD_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read'])

function dappPreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'dapp-preload.mjs'),
    path.join(__dirname, 'dapp-preload.js'),
    path.join(__dirname, 'preload', 'dapp-preload.mjs'),
  ]
  const found = candidates.find((item) => existsSync(item))
  if (!found) console.warn('[dapp] 缺少 guest preload', candidates[0])
  return found ?? candidates[0]
}

/** 浏览器标签页的 guest 进程：只允许 https，不继承钱包 preload。 */
function hardenWebviewGuests(): void {
  const explorer = session.fromPartition('persist:explorer')
  explorer.setPermissionCheckHandler((_contents, permission) => CLIPBOARD_PERMISSIONS.has(permission))
  explorer.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(CLIPBOARD_PERMISSIONS.has(permission))
  })
  installWalletConnectProtocol(explorer)
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    attachWalletConnectCapture(contents)
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
    if (findWalletConnectDeepLink([url])) {
      void acceptWalletConnectDeepLink(url)
      return { action: 'deny' }
    }
    if (isHttpsUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-attach-webview', (event, prefs, params) => {
    delete (prefs as { preloadURL?: string }).preloadURL
    const preload = dappPreloadPath()
    prefs.preload = preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.javascript = true
    console.log('[dapp] guest preload', preload, params.src)
    if (!isHttpsUrl(params.src) && !params.src.startsWith('about:')) event.preventDefault()
  })

  // 禁止导航到非本地页面，防止 XSS 后跳转钓鱼页
  win.webContents.on('will-navigate', (event, url) => {
    if (findWalletConnectDeepLink([url])) {
      event.preventDefault()
      void acceptWalletConnectDeepLink(url)
      return
    }
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
  app.on('second-instance', (_event, argv) => {
    const link = findWalletConnectDeepLink(argv)
    if (link) void acceptWalletConnectDeepLink(link)
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else if (app.isReady()) {
      // macOS 关窗后进程仍在，第二次启动需要重建窗口
      createWindow()
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  void acceptWalletConnectDeepLink(url)
})

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

app.whenReady().then(async () => {
  app.setAsDefaultProtocolClient('wc')
  app.setAsDefaultProtocolClient('walletconnect')
  app.setAsDefaultProtocolClient('bee-wallet')
  installWalletConnectProtocol()
  await bootstrap()
  applyContentSecurityPolicy()
  hardenWebviewGuests()
  ensureLinuxDevDesktopEntry()
  installAppMenu()
  createWindow()
  const launched = findWalletConnectDeepLink(process.argv)
  if (launched) void acceptWalletConnectDeepLink(launched)
})
