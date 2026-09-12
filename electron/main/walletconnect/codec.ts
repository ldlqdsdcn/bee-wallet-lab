/**
 * WalletConnect URI / 会话摘要 / 待确认请求解析。
 */
import type { WalletConnectPending, WalletConnectSession } from '@shared/types'

const WC_URI = /^wc:[^\s"'<>\\]+$/
const QUERY_KEYS = ['uri', 'wc', 'walletconnect', 'walletConnectUri', 'walletConnectURI'] as const

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function takeWcToken(value: string): string | null {
  const index = value.indexOf('wc:')
  if (index < 0) return null
  const rest = value.slice(index).trim()
  const end = rest.search(/[\s"'<>\\]/)
  const uri = (end >= 0 ? rest.slice(0, end) : rest).replace(/[),.;]+$/, '')
  return uri.startsWith('wc:') ? uri : null
}

function queryParam(value: string, names: readonly string[]): string | null {
  const queryIndex = value.indexOf('?')
  if (queryIndex < 0) return null
  const hashIndex = value.indexOf('#', queryIndex)
  const query = value.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    const key = tryDecode(eq >= 0 ? part.slice(0, eq) : part)
    if (names.includes(key)) return eq >= 0 ? tryDecode(part.slice(eq + 1)) : ''
  }
  return null
}

/** 对齐 OneWallet：完整留下 wc: 链接，避免正则把 symKey 截断。 */
export function extractWalletConnectUri(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('wc:')) return trimmed
  const fromQuery = takeWcToken(queryParam(trimmed, QUERY_KEYS) ?? '')
  const decoded = tryDecode(trimmed)
  if (decoded.startsWith('wc:')) return takeWcToken(decoded)
  const embedded = takeWcToken(trimmed) ?? takeWcToken(decoded)
  if (fromQuery && embedded && !fromQuery.includes('symKey=') && embedded.includes('symKey=') && embedded.startsWith(fromQuery)) {
    return embedded
  }
  return fromQuery ?? embedded
}

export function parseWalletConnectUri(raw: string): string {
  if (!raw.trim()) throw new Error('请粘贴 WalletConnect 链接')
  const found = extractWalletConnectUri(raw)
  if (!found) throw new Error('这不是 WalletConnect 链接（应包含 wc:）')
  if (!WC_URI.test(found)) throw new Error('WalletConnect 链接格式无效')
  return found
}

export function chainIdDecimal(raw: string): string {
  const value = raw.trim()
  if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value).toString(10)
  if (/^\d+$/.test(value)) return BigInt(value).toString(10)
  const caip = value.match(/^eip155:(\d+)$/)
  if (caip) return caip[1]
  throw new Error(`无法识别 chainId：${raw}`)
}

export function toCaipChain(chainId: string): string {
  return `eip155:${chainIdDecimal(chainId)}`
}

export function toHexChainId(raw: string): string {
  return `0x${BigInt(chainIdDecimal(raw)).toString(16)}`
}

/** EIP-5792：告诉网站我们不会批量代发，让它走普通 eth_sendTransaction。 */
export function walletCapabilities(params: unknown[], fallbackChains: string[]): Record<string, Record<string, unknown>> {
  const none = {
    atomic: { status: 'unsupported' },
    atomicBatch: { supported: false },
    paymasterService: { supported: false },
    auxiliaryFunds: { supported: false },
  }
  const requested = Array.isArray(params[1]) ? params[1] : []
  const raw = requested.length ? requested.map(String) : fallbackChains
  const chains = raw.map((item) => {
    try {
      return toHexChainId(item)
    } catch {
      return null
    }
  })
  return Object.fromEntries(chains.filter((item): item is string => Boolean(item)).map((id) => [id, none]))
}

export function toCaipAccount(chainId: string, address: string): string {
  return `${toCaipChain(chainId)}:${address}`
}

export function sessionSummary(session: {
  topic: string
  expiry?: number
  peer?: { metadata?: { name?: string; url?: string; icons?: string[] } }
  namespaces?: Record<string, { chains?: string[]; accounts?: string[] }>
}): WalletConnectSession {
  const eip = session.namespaces?.eip155
  return {
    topic: session.topic,
    name: session.peer?.metadata?.name?.trim() || session.peer?.metadata?.url || 'DApp',
    url: session.peer?.metadata?.url || '',
    icon: session.peer?.metadata?.icons?.[0] || '',
    chains: eip?.chains?.length ? eip.chains : (eip?.accounts ?? []).map((item) => item.split(':').slice(0, 2).join(':')),
    expiry: session.expiry ?? 0,
  }
}

export function hexToUtf8(value: string): string {
  const raw = value.trim()
  if (!raw.startsWith('0x') && !raw.startsWith('0X')) return raw
  const hex = raw.slice(2)
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return raw
  try {
    return decodeURIComponent(hex.replace(/../g, '%$&'))
  } catch {
    return raw
  }
}

export function describeWcRequest(method: string, params: unknown[]): string {
  if (method === 'personal_sign' || method === 'eth_sign') {
    const message = typeof params[0] === 'string' && params[0].startsWith('0x') && method === 'personal_sign'
      ? hexToUtf8(params[0])
      : typeof params[1] === 'string' && method === 'personal_sign'
        ? hexToUtf8(params[1])
        : JSON.stringify(params[0] ?? '')
    return message
  }
  if (method.startsWith('eth_signTypedData')) {
    const typed = params.find((item) => typeof item === 'string' && item.trim().startsWith('{'))
    return typeof typed === 'string' ? typed : JSON.stringify(params, null, 2)
  }
  if (method === 'eth_sendTransaction') {
    return JSON.stringify(params[0] ?? {}, null, 2)
  }
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    return JSON.stringify(params[0] ?? {}, null, 2)
  }
  return JSON.stringify(params, null, 2)
}

const CHAIN_LABEL: Record<string, string> = {
  'eip155:1': 'Ethereum',
  'eip155:56': 'BSC',
  'eip155:97': 'BSC 测试网',
  'eip155:8453': 'Base',
  'eip155:42161': 'Arbitrum',
  'eip155:11155111': 'Sepolia',
}

export function describeSessionProposal(params: {
  url?: string
  requiredNamespaces?: Record<string, { chains?: string[] }>
  optionalNamespaces?: Record<string, { chains?: string[] }>
}): string {
  const chains = [
    ...(params.requiredNamespaces?.eip155?.chains ?? []),
    ...(params.optionalNamespaces?.eip155?.chains ?? []),
  ]
  const labels = [...new Set(chains)].map((item) => CHAIN_LABEL[item] || item.replace('eip155:', '链 '))
  return [`网站：${params.url || ''}`, '将授权读取你的地址，并允许网站在这些链上请求签名或发交易：', labels.join('、') || 'EVM'].join('\n')
}

export function pendingKind(method: string): WalletConnectPending['kind'] {
  if (method === 'eth_sendTransaction') return 'send'
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return 'switch'
  return 'sign'
}
