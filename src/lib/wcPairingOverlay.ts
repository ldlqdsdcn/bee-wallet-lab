type ExplorerWebview = HTMLElement & {
  executeJavaScript: (code: string) => Promise<unknown>
}

function hideScript(): string {
  return `(() => {
    var el = document.getElementById('bee-wallet-pairing-mask')
    if (el) el.remove()
  })()`
}

function showScript(title: string, message: string, left: string): string {
  return `(() => {
    var id = 'bee-wallet-pairing-mask'
    var el = document.getElementById(id)
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;cursor:wait;'
      var stop = function (event) { event.stopPropagation(); event.preventDefault() }
      ;['click','mousedown','mouseup','pointerdown','pointerup','touchstart','keydown','wheel'].forEach(function (name) {
        el.addEventListener(name, stop, true)
      })
      ;(document.documentElement || document.body).appendChild(el)
    }
    var title = ${JSON.stringify(title)}
    var message = ${JSON.stringify(message)}
    var left = ${JSON.stringify(left)}
    el.innerHTML = '<div style="background:#12141a;color:#e8e8ea;border:1px solid #2a2e3a;border-radius:16px;padding:22px 24px;min-width:280px;max-width:min(420px,90vw);box-shadow:0 16px 48px rgba(0,0,0,.45)">'
      + '<div style="display:flex;align-items:center;gap:10px">'
      + '<span style="width:16px;height:16px;border:2px solid #f5c518;border-top-color:transparent;border-radius:50%;display:inline-block;animation:bee-wc-spin .8s linear infinite"></span>'
      + '<div style="font-size:14px;font-weight:600">' + title + '</div></div>'
      + '<div style="margin-top:10px;font-size:13px;color:#b4b8c2">' + message + '</div>'
      + '<div style="margin-top:8px;font-size:12px;color:#8b8f9a">' + left + '</div></div>'
    if (!document.getElementById('bee-wallet-pairing-spin')) {
      var style = document.createElement('style')
      style.id = 'bee-wallet-pairing-spin'
      style.textContent = '@keyframes bee-wc-spin{to{transform:rotate(360deg)}}'
      document.documentElement.appendChild(style)
    }
  })()`
}

function webviews(): ExplorerWebview[] {
  return [...document.querySelectorAll('webview.explorer-webview')] as ExplorerWebview[]
}

/** 盖在网站页面上，挡住点击。webview 会盖住 React 层，必须注入进去。 */
export function applyWalletConnectPairingOverlay(show: boolean, title = '', message = '', left = ''): void {
  const code = show ? showScript(title, message, left) : hideScript()
  for (const view of webviews()) {
    view.style.pointerEvents = show ? 'none' : 'auto'
    void view.executeJavaScript(code).catch(() => undefined)
  }
}

export function watchWalletConnectPairingOverlay(show: boolean, title: string, message: string, left: string): () => void {
  applyWalletConnectPairingOverlay(show, title, message, left)
  const onReady = (event: Event) => {
    const view = event.currentTarget as ExplorerWebview
    view.style.pointerEvents = show ? 'none' : 'auto'
    void view.executeJavaScript(show ? showScript(title, message, left) : hideScript()).catch(() => undefined)
  }
  const nodes = webviews()
  for (const view of nodes) view.addEventListener('dom-ready', onReady)
  return () => {
    for (const view of nodes) view.removeEventListener('dom-ready', onReady)
    if (!show) applyWalletConnectPairingOverlay(false)
  }
}
