/** 跑在 DApp 页面主世界。依赖 preload 挂上的 window.beeDapp，不冒充 MetaMask。 */
export const DAPP_PROVIDER_INJECT = `(() => {
  if (window.__beeWalletProvider) return true
  if (!window.beeDapp || typeof window.beeDapp.request !== 'function') {
    console.warn('[dapp] beeDapp 未挂上，页面拿不到钱包')
    return false
  }
  window.__beeWalletProvider = true
  var listeners = {}
  var selectedAddress = null
  var chainId = null
  var info = window.beeWalletProviderInfo || {
    uuid: 'a6c8d2e1-7b54-4f0a-9c31-2e8c4b0f1a77',
    name: 'Bee Wallet Lab',
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%23f5c518"/%3E%3Ctext x="16" y="21" text-anchor="middle" font-size="14" font-family="sans-serif" fill="%23111111"%3EB%3C/text%3E%3C/svg%3E',
    rdns: 'lab.bee-wallet',
  }
  function emit(name, value) {
    (listeners[name] || []).slice().forEach(function (fn) {
      try { fn(value) } catch (e) {}
    })
  }
  function fail(code, message) {
    var error = new Error(message || 'Provider request failed')
    error.code = code
    return error
  }
  function request(args) {
    if (!args || typeof args.method !== 'string') {
      return Promise.reject(fail(-32600, 'Invalid request'))
    }
    return window.beeDapp.request({
      method: args.method,
      params: Array.isArray(args.params) ? args.params : [],
    }).then(function (result) {
      if (!result || result.ok === false) {
        throw fail(result && result.code ? result.code : 4900, result && result.message)
      }
      var data = result.data
      if ((args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') && Array.isArray(data)) {
        selectedAddress = data[0] || null
        emit('accountsChanged', data)
      }
      if (args.method === 'eth_chainId' && typeof data === 'string') chainId = data
      if (args.method === 'wallet_switchEthereumChain' && args.params && args.params[0] && args.params[0].chainId) {
        chainId = args.params[0].chainId
        emit('chainChanged', chainId)
      }
      return data
    })
  }
  var provider = {
    isBeeWallet: true,
    request: request,
    enable: function () { return request({ method: 'eth_requestAccounts' }) },
    send: function (methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        return request({ method: methodOrPayload, params: Array.isArray(paramsOrCallback) ? paramsOrCallback : [] })
      }
      if (typeof paramsOrCallback === 'function') {
        request(methodOrPayload).then(
          function (value) { paramsOrCallback(null, { id: 1, jsonrpc: '2.0', result: value }) },
          function (err) { paramsOrCallback(err) }
        )
        return
      }
      return request(methodOrPayload)
    },
    isConnected: function () { return true },
    on: function (name, fn) {
      if (typeof fn === 'function') {
        listeners[name] = listeners[name] || []
        listeners[name].push(fn)
      }
      return provider
    },
    removeListener: function (name, fn) {
      listeners[name] = (listeners[name] || []).filter(function (item) { return item !== fn })
      return provider
    },
  }
  provider.addListener = provider.on
  provider.off = provider.removeListener
  provider.sendAsync = provider.send
  Object.defineProperty(provider, 'selectedAddress', { get: function () { return selectedAddress } })
  Object.defineProperty(provider, 'chainId', { get: function () { return chainId } })
  function announce() {
    try {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: { info: info, provider: provider },
      }))
    } catch (e) {}
  }
  window.addEventListener('eip6963:requestProvider', announce)
  if (!window.ethereum) window.ethereum = provider
  announce()
  setTimeout(announce, 0)
  console.log('[dapp] 已注入 Bee Wallet Lab')
  return true
})()`

/** 截网站出示的 wc:：二维码属性、复制、window.open。不扫页面像素，不按站点写规则。 */
export const DAPP_DEEP_LINK_INJECT = `(() => {
  if (window.__beeWalletDeepLink) return true
  if (!window.beeDapp || typeof window.beeDapp.pairDeepLink !== 'function') return false
  window.__beeWalletDeepLink = true
  var last = ''
  function isWc(raw) {
    var text = String(raw || '')
    return text.indexOf('wc:') >= 0 || text.indexOf('walletconnect.com/wc') >= 0 || text.indexOf('link.walletconnect') >= 0
  }
  function offer(raw) {
    var text = String(raw || '')
    if (text.indexOf('wc:') < 0 || text.indexOf('symKey=') < 0) return
    var uri = text.slice(text.indexOf('wc:')).split(/[\\s"'<>\\\\]/)[0].replace(/[),.;]+$/, '')
    if (!uri || uri === last) return
    last = uri
    console.log('[dapp] 页面出示 WalletConnect 链接')
    try { window.beeDapp.pairDeepLink(uri) } catch (e) {}
  }
  function scan(node) {
    if (!node) return
    try {
      if (node.getAttribute) {
        ;['uri', 'data-uri', 'href', 'alt', 'value'].forEach(function (name) {
          offer(node.getAttribute(name) || '')
        })
      }
      if (node.shadowRoot) walk(node.shadowRoot)
    } catch (e) {}
  }
  function walk(root) {
    if (!root) return
    scan(root)
    var nodes
    try { nodes = root.querySelectorAll('*') } catch (e) { return }
    for (var i = 0; i < nodes.length; i++) scan(nodes[i])
  }
  var open = window.open
  window.open = function (url) {
    offer(String(url || ''))
    if (isWc(url)) {
      return { closed: false, close: function () {}, focus: function () {}, location: { href: String(url || '') } }
    }
    return open.apply(window, arguments)
  }
  try {
    var href = Object.getOwnPropertyDescriptor(Location.prototype, 'href')
    if (href && href.set) {
      Object.defineProperty(Location.prototype, 'href', {
        configurable: true,
        get: href.get,
        set: function (value) {
          offer(String(value || ''))
          if (isWc(value)) return
          return href.set.call(this, value)
        },
      })
    }
  } catch (e) {}
  try {
    var clip = navigator.clipboard
    if (clip && clip.writeText) {
      var writeText = clip.writeText.bind(clip)
      clip.writeText = function (text) {
        offer(String(text || ''))
        return writeText(text)
      }
    }
  } catch (e) {}
  document.addEventListener('click', function () {
    setTimeout(function () { walk(document) }, 200)
    setTimeout(function () { walk(document) }, 1200)
  }, true)
  try {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var rec = records[i]
        if (rec.type === 'attributes') scan(rec.target)
        var added = rec.addedNodes || []
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) walk(added[j])
          if (added[j].nodeType === 3) offer(added[j].textContent || '')
        }
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['uri', 'data-uri', 'href', 'alt', 'value'],
    })
  } catch (e) {}
  walk(document)
  console.log('[dapp] 已监听 WalletConnect 深链接')
  return true
})()`
