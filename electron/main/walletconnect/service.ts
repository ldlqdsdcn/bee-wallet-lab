/**
 * WalletConnect 钱包端：配对、确认、签名/发交易、断开。密钥不离开主进程。
 */
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { WalletKitTypes } from '@reown/walletkit'
import type { AuthTypes, JsonRpcRecord, Verify } from '@walletconnect/types'
import { installWalletConnectWebSocket } from './installWs'
import { buildApprovedNamespaces, buildAuthObject, getSdkError, populateAuthPayload } from '@walletconnect/utils'
import { bytesToHex, hashTypedData, type Hex, type TypedDataDefinition } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hexToBytes } from '@noble/hashes/utils'
import type {
  AccountRecord,
  NetworkRecord,
  WalletConnectPairing,
  WalletConnectPending,
  WalletConnectSession,
  WalletConnectStatus,
} from '@shared/types'
import { IPC_EVENT } from '../../../shared/ipc'
import { findNetworkByChain, getNetwork, listNetworks } from '../db/repos/catalogRepo'
import { getAccountRow } from '../db/repos/accountRepo'
import { loadSettings, saveSettings } from '../db/repos/metaRepo'
import { broadcast, IpcError, invalidArg } from '../ipc/registry'
import { t } from '../i18n'
import { getStatus } from '../security/vault'
import { getCurrentWallet, listAccounts, withAccountPrivateKey } from '../wallets/service'
import {
  broadcastEvmTx,
  estimateEvmGas,
  evmRpc,
  getEvmNonce,
  quoteEvmFees,
  signAndSerializeEvmTx,
} from '../chain/evm'
import { personalSign } from '../sign/evm'
import { walletConnectProjectId, walletConnectRelayUrl } from '../rpc/walletconnectEnv'
import { createFileKeyValueStorage } from './storage'
import { applyPairingOverlay } from './pairingOverlay'
import { guardVerifyResolution, installVerifyFetch, verificationStatus } from './verify'
import {
  chainIdDecimal,
  describeSessionProposal,
  describeWcRequest,
  hexToUtf8,
  pairingTopicFromUri,
  parseWalletConnectUri,
  pendingKind,
  sessionSummary,
  toCaipChain,
  toHexChainId,
  walletCapabilities,
} from './codec'

type WalletKitCtor = (typeof import('@reown/walletkit'))['WalletKit']
type Kit = Awaited<ReturnType<WalletKitCtor['init']>>

const METHODS = [
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'wallet_getPermissions',
  'wallet_requestPermissions',
  'wallet_watchAsset',
  'wallet_getCapabilities',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
  'eth_sendRawTransaction',
  'eth_signTransaction',
  'net_version',
]

const READ = new Set([
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'wallet_getPermissions',
  'wallet_requestPermissions',
  'wallet_getCapabilities',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
  'net_version',
])

let kit: Kit | null = null
let starting: Promise<Kit> | null = null
let pairLock: Promise<void> | null = null
let pairAbort: AbortController | null = null
let expectedPairingTopic: string | null = null
let queuedDeepLink: string | null = null
/** 等待网站提案。到点就停，不再后台空等。 */
export const PAIR_PROPOSAL_WAIT_MS = 45_000
export const PAIR_OVERLAY_MS = PAIR_PROPOSAL_WAIT_MS
export const WALLETCONNECT_PAIR_WAIT_MS = PAIR_PROPOSAL_WAIT_MS

let pairingState: WalletConnectPairing = { active: false, error: null, deadlineAt: null }
const stalePairingTopics = new Set<string>()
const handledSessionIds = new Set<number>()
const handledRequestIds = new Set<string>()
const sendCallRecords = new Map<string, { chainId: string; hashes: string[] }>()
const sessionWaiters = new Set<(kind: 'proposal' | 'auth') => void>()
let lastIncomingSession: 'proposal' | 'auth' | null = null
const pending = new Map<
  string,
  {
    item: WalletConnectPending
    resolve: (ok: boolean) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

export function walletConnectStatus(): WalletConnectStatus {
  const projectId = walletConnectProjectId()
  return {
    ready: Boolean(kit),
    projectIdSet: Boolean(projectId),
    error: projectId ? null : '请在 .env 填写 WALLET_CONNECT_PROJECT_ID',
  }
}

export function walletConnectPairing(): WalletConnectPairing {
  return pairingState
}

function setPairing(active: boolean, error: string | null = null): void {
  pairingState = {
    active,
    error,
    deadlineAt: active ? Date.now() + PAIR_PROPOSAL_WAIT_MS : null,
  }
  if (active) focusWalletWindow()
  applyPairingOverlay(active, pairingState.deadlineAt)
  broadcast(IPC_EVENT.walletConnectPairing, pairingState)
  if (!active && error) {
    setTimeout(() => {
      if (!pairingState.active && pairingState.error === error) setPairing(false)
    }, 6000)
  }
}

export function cancelWalletConnectPair(): void {
  pairAbort?.abort()
  expectedPairingTopic = null
  lastIncomingSession = null
  setPairing(false)
  console.log('[walletconnect] 已取消等待')
}

function pairWaitTimeout(): IpcError {
  return new IpcError('PAIR_WAIT_TIMEOUT', t('wc.waitingTimeout'))
}

function pairReplaced(): IpcError {
  return new IpcError('PAIR_REPLACED', '连接已改用新的链接')
}

function isPairWaitTimeout(err: unknown): boolean {
  return err instanceof IpcError && err.code === 'PAIR_WAIT_TIMEOUT'
}

function isPairReplaced(err: unknown): boolean {
  return err instanceof IpcError && err.code === 'PAIR_REPLACED'
}

async function replaceInFlightPair(): Promise<void> {
  const prev = pairLock
  pairAbort?.abort()
  if (!prev) return
  await Promise.race([prev.catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, 1500))])
}

export async function startWalletConnect(): Promise<Kit | null> {
  if (kit) return kit
  if (starting) return starting
  const projectId = walletConnectProjectId()
  if (!projectId) return null
  starting = (async () => {
    installWalletConnectWebSocket()
    installVerifyFetch()
    process.env.DISABLE_GLOBAL_CORE = 'true'
    const { Core } = await import('@walletconnect/core')
    const { WalletKit } = await import('@reown/walletkit')
    const core = new Core({
      projectId,
      relayUrl: walletConnectRelayUrl(),
      customStoragePrefix: 'bee-wallet',
      storage: createFileKeyValueStorage(path.join(app.getPath('userData'), 'walletconnect.json')),
    })
    guardVerifyResolution(core.verify)
    // 只记录方法和链，不把交易参数、签名内容或密钥写入日志。
    core.history.on('history_created', (record: JsonRpcRecord) => {
      if (record.request?.method !== 'wc_sessionRequest') return
      const params = record.request.params
      console.log('[walletconnect] 中继请求已解密，进入 SDK 校验',
        params?.request?.method, params?.chainId, record.id)
    })
    const next = await WalletKit.init({
      core,
      metadata: {
        name: 'Bee Wallet Lab',
        description: '本地优先的多链实验钱包',
        url: 'https://github.com/ldlqdsdcn/bee-wallet-lab',
        icons: [],
        redirect: {
          native: 'bee-wallet://wc',
          universal: 'https://github.com/ldlqdsdcn/bee-wallet-lab',
        },
      },
    })
    // 中继重连期间就可能收到事件，处理器必须已经能取得当前 client。
    kit = next
    attachSessionListeners(next)
    next.on('proposal_expire', () => {
      console.warn('[walletconnect] 连接请求已过期。请在网站上重新打开 WalletConnect，立刻复制新链接。')
    })
    try {
      if (!next.core.relayer.connected) await next.core.relayer.transportOpen()
    } catch (err) {
      console.warn('[walletconnect] 中继尚未连通', err instanceof Error ? err.message : err)
    }
    drainPendingProposals(next)
    drainPendingAuthentications(next)
    drainPendingSessionRequests(next)
    watchSessionList(next)
    broadcastSessions()
    return next
  })()
  try {
    return await starting
  } finally {
    starting = null
  }
}

const grantedOrigins = new Set<string>()

class ProviderError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export async function handleDappProviderRequest(origin: string, method: string, params: unknown[]): Promise<unknown> {

  if (!getStatus().unlocked) throw new ProviderError(4100, '请先解锁钱包')
  const network = currentNetwork()
  if (!network) throw new ProviderError(4901, '请先选择 EVM 网络')
  const chainId = toCaipChain(network.chainId)
  const requestParams = Array.isArray(params) ? params : []

  if (method === 'eth_accounts' || method === 'wallet_getPermissions') {
    if (!grantedOrigins.has(origin)) return method === 'wallet_getPermissions' ? [] : []
    return method === 'wallet_getPermissions'
      ? [{ parentCapability: 'eth_accounts' }]
      : [requireEvmAccount().address]
  }
  if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
    if (!grantedOrigins.has(origin)) {
      const approved = await confirm({
        kind: 'session',
        origin,
        name: origin,
        method: 'eth_requestAccounts',
        detail: origin,
      })
      if (!approved) throw new ProviderError(4001, '用户拒绝')
      grantedOrigins.add(origin)
    }
    return method === 'wallet_requestPermissions'
      ? [{ parentCapability: 'eth_accounts' }]
      : [requireEvmAccount().address]
  }
  if (READ.has(method)) return handleRead(method, requestParams, chainId)
  const approved = await confirm({
    kind: pendingKind(method),
    origin,
    name: origin,
    method,
    detail: describeWcRequest(method, requestParams),
  })
  if (!approved) throw new ProviderError(4001, '用户拒绝')
  return handleWrite(method, requestParams, chainId)
}


export function rejectWalletConnectPending(reason = '钱包已锁定'): void {
  grantedOrigins.clear()
  for (const item of pending.values()) {
    clearTimeout(item.timer)
    item.reject(new Error(reason))
  }
  pending.clear()
  broadcastPending()
}

export async function pairWalletConnect(uri: string): Promise<WalletConnectSession[]> {
  try {
    return await pairWalletConnectInner(uri)
  } catch (err) {
    if (isPairReplaced(err)) throw err
    const message = err instanceof Error ? err.message : String(err)
    setPairing(false, isPairWaitTimeout(err) ? null : message)
    throw err
  }
}

function hasPairingTopic(client: Kit, topic: string): boolean {
  try {
    return (client.core.pairing.getPairings() ?? []).some((item) => item.topic === topic)
  } catch {
    return false
  }
}

function hasSessionForPairing(client: Kit, topic: string): boolean {
  return Object.values(client.getActiveSessions()).some(
    (session) => pairingTopicOf(session as { pairingTopic?: string }) === topic,
  )
}

function hasOpenConfirm(): boolean {
  return [...pending.values()].some((item) => item.item.kind === 'session' || item.item.kind === 'auth')
}

function watchProposal(client: Kit): void {
  if (pairLock) return
  const abort = new AbortController()
  pairAbort = abort
  const pairing = (async () => {
    const tick = setInterval(() => {
      if (abort.signal.aborted) return
      drainPendingProposals(client)
      drainPendingAuthentications(client)
    }, 1000)
    try {
      if (hasOpenConfirm() || lastIncomingSession) return
      await waitForIncomingSession(PAIR_PROPOSAL_WAIT_MS, abort.signal)
    } catch (err) {
      if (isPairReplaced(err)) throw err
      drainPendingProposals(client)
      drainPendingAuthentications(client)
      if (!lastIncomingSession && !hasOpenConfirm()) throw err
    } finally {
      clearInterval(tick)
    }
  })()
  pairLock = pairing
  void pairing.then(
    () => {
      if (pairLock !== pairing || abort.signal.aborted) return
      setPairing(false)
    },
    (err) => {
      if (pairLock !== pairing || abort.signal.aborted) return
      if (isPairReplaced(err)) return
      if (isPairWaitTimeout(err)) console.log('[walletconnect] 等待网站确认超时')
      expectedPairingTopic = null
      setPairing(false, isPairWaitTimeout(err) ? t('wc.waitingTimeout') : err instanceof Error ? err.message : String(err))
    },
  ).finally(() => {
    if (pairLock === pairing) pairLock = null
    if (pairAbort === abort) pairAbort = null
  })
}

async function pairWalletConnectInner(uri: string): Promise<WalletConnectSession[]> {
  if (!getStatus().unlocked) throw invalidArg('请先解锁钱包')
  if (hasOpenConfirm()) {
    throw invalidArg('请先确认当前弹窗，再连接下一个网站。')
  }
  const client = await requireKit()
  const parsed = parseWalletConnectUri(uri)
  if (!parsed.includes('symKey=')) {
    throw invalidArg('链接不完整，缺少 symKey。请复制二维码下方以 wc: 开头的整段链接。')
  }
  const topic = pairingTopicFromUri(parsed)
  if (hasSessionForPairing(client, topic)) {
    return listWalletConnectSessions()
  }

  const waitingThis = expectedPairingTopic === topic && Boolean(pairLock)
  if (waitingThis || (hasPairingTopic(client, topic) && pairLock && expectedPairingTopic === topic)) {
    console.log('[walletconnect] 这条链接已经在配对，继续等网站确认', topic.slice(0, 16))
    setPairing(true)
    drainPendingProposals(client)
    drainPendingAuthentications(client)
    watchProposal(client)
    return listWalletConnectSessions()
  }

  if (pairLock || expectedPairingTopic) {
    if (expectedPairingTopic && expectedPairingTopic !== topic) stalePairingTopics.add(expectedPairingTopic)
    console.log('[walletconnect] 改用最新链接')
    await replaceInFlightPair()
  }

  stalePairingTopics.delete(topic)
  expectedPairingTopic = topic
  setPairing(true)
  lastIncomingSession = null
  try {
    if (!client.core.relayer.connected) await client.core.relayer.transportOpen()
  } catch {
    /* pair 里还会再连一次 */
  }
  if (hasPairingTopic(client, topic)) {
    console.log('[walletconnect] 配对已存在，继续等网站确认', topic.slice(0, 16))
    // activate 只更新本地状态；上次订阅失败时必须重新订阅才能收到提案。
    await client.core.relayer.subscribe(topic)
    await client.core.pairing.activate({ topic })
    drainPendingProposals(client)
    drainPendingAuthentications(client)
    watchProposal(client)
    return listWalletConnectSessions()
  }
  console.log('[walletconnect] 开始配对', {
    chars: parsed.length,
    hasSymKey: parsed.includes('symKey='),
    topic,
  })
  try {
    await client.pair({ uri: parsed, activatePairing: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (hasPairingTopic(client, topic) && /already|exist/i.test(message)) {
      console.log('[walletconnect] 配对已在中继上，等待网站确认', topic.slice(0, 16))
      watchProposal(client)
      return listWalletConnectSessions()
    }
    expectedPairingTopic = null
    setPairing(false, message)
    if (/subscribing/i.test(message) || /please try again/i.test(message)) {
      throw invalidArg('连不上 WalletConnect 中继。直连 relay.walletconnect.com 会超时，请先在设置里打开代理后再配对')
    }
    throw err
  }
  console.log('[walletconnect] 配对请求已交给中继，等待网站确认')
  watchProposal(client)
  return listWalletConnectSessions()
}

/** 网站或系统打开的 wc: 深链接。不是扫页面二维码。 */
export async function acceptWalletConnectDeepLink(raw: string): Promise<{ ignored?: boolean }> {
  let uri: string
  try {
    uri = parseWalletConnectUri(raw)
  } catch {
    return {}
  }
  if (!uri.includes('symKey=')) return {}
  if (!getStatus().unlocked) {
    queuedDeepLink = uri
    focusWalletWindow()
    console.log('[walletconnect] 深链接已记下，解锁后再连接')
    return {}
  }
  focusWalletWindow()
  try {
    console.log('[walletconnect] 收到深链接', uri.slice(3, uri.indexOf('@') > 0 ? uri.indexOf('@') : 19))
    await pairWalletConnect(uri)
  } catch (err) {
    if (isPairWaitTimeout(err)) {
      console.log('[walletconnect] 等待网站确认超时')
      return {}
    }
    if (isPairReplaced(err)) return {}
    const message = err instanceof Error ? err.message : String(err)
    if (/已经用过|还在进行|请先确认|改用新的/.test(message)) {
      console.log('[walletconnect] 深链接已忽略', message)
      return {}
    }
    console.warn('[walletconnect] 深链接配对失败', message)
  }
  return {}
}

export function flushQueuedWalletConnectDeepLink(): void {
  const raw = queuedDeepLink
  queuedDeepLink = null
  if (raw) void acceptWalletConnectDeepLink(raw)
}

export async function reconnectWalletConnectRelay(): Promise<void> {
  if (!kit) return
  try {
    await kit.core.relayer.restartTransport()
  } catch {
    try {
      await kit.core.relayer.transportOpen()
    } catch (err) {
      console.warn('[walletconnect] 中继重连失败', err instanceof Error ? err.message : err)
    }
  }
}

export function listWalletConnectSessions(): WalletConnectSession[] {
  if (!kit) return []
  return Object.values(kit.getActiveSessions()).map((session) => sessionSummary(session))
}

export async function disconnectWalletConnect(topic: string): Promise<WalletConnectSession[]> {
  const client = await requireKit()
  pairAbort?.abort()
  expectedPairingTopic = null
  lastIncomingSession = null
  setPairing(false)
  await forgetSession(client, topic, 'wallet')
  return listWalletConnectSessions()
}

export function listWalletConnectPending(): WalletConnectPending[] {
  return [...pending.values()].map((item) => item.item)
}

export function decideWalletConnect(id: string, approve: boolean): void {
  const item = pending.get(id)
  if (!item) throw invalidArg('这条请求已经失效')
  pending.delete(id)
  clearTimeout(item.timer)
  broadcastPending()
  item.resolve(approve)
}

export async function notifyWalletConnectNetwork(): Promise<void> {
  if (!kit) return
  const network = currentNetwork()
  const account = currentEvmAccount()
  if (!network || !account) return
  const chainId = toCaipChain(network.chainId)
  for (const session of Object.values(kit.getActiveSessions())) {
    try {
      await kit.emitSessionEvent({
        topic: session.topic,
        event: { name: 'chainChanged', data: `0x${BigInt(chainIdDecimal(network.chainId)).toString(16)}` },
        chainId,
      })
      await kit.emitSessionEvent({
        topic: session.topic,
        event: { name: 'accountsChanged', data: [account.address] },
        chainId,
      })
    } catch {
      /* 个别会话过期不挡切换网络 */
    }
  }
}

async function requireKit(): Promise<Kit> {
  const client = await startWalletConnect()
  if (!client) throw invalidArg(walletConnectStatus().error || 'WalletConnect 未配置')
  return client
}

function noteSessionEvent(kind: 'proposal' | 'auth', id: number): boolean {
  if (handledSessionIds.has(id)) return false
  handledSessionIds.add(id)
  lastIncomingSession = kind
  for (const wait of [...sessionWaiters]) wait(kind)
  return true
}

function waitForIncomingSession(ms: number, signal?: AbortSignal): Promise<'proposal' | 'auth'> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearTimeout(timer)
      sessionWaiters.delete(onEvent)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = () => finish(() => reject(pairReplaced()))
    const timer = setTimeout(() => finish(() => reject(pairWaitTimeout())), ms)
    const onEvent = (kind: 'proposal' | 'auth') => finish(() => resolve(kind))
    if (signal?.aborted) {
      reject(pairReplaced())
      return
    }
    signal?.addEventListener('abort', onAbort)
    sessionWaiters.add(onEvent)
  })
}

function pairingTopicOf(value: { pairingTopic?: string; topic?: string } | undefined): string {
  return (value?.pairingTopic || value?.topic || '').trim()
}

function isCurrentPairingTopic(topic: string | undefined): boolean {
  if (topic && stalePairingTopics.has(topic)) return false
  if (!expectedPairingTopic) return true
  if (!topic) return true
  return topic === expectedPairingTopic
}


function peerOrigin(url: string | undefined): string {
  const raw = (url || '').trim()
  try {
    return new URL(raw).origin
  } catch {
    return raw.toLowerCase()
  }
}

async function disconnectOtherSessions(client: Kit, url: string, keepTopic?: string): Promise<void> {
  const origin = peerOrigin(url)
  if (!origin || !keepTopic) return
  for (const session of Object.values(client.getActiveSessions())) {
    if (session.topic === keepTopic) continue
    if (peerOrigin(session.peer.metadata.url) !== origin) continue
    try {
      await client.disconnectSession({ topic: session.topic, reason: getSdkError('USER_DISCONNECTED') })
      console.log('[walletconnect] 已断开同一网站的旧会话', origin)
    } catch {
      /* 旧会话可能已经过期 */
    }
  }
}

function signClientOf(client: Kit): {
  on?: (name: string, fn: (event: unknown) => void) => void
  events?: { on?: (name: string, fn: (event: unknown) => void) => void }
  ping?: (args: { topic: string }) => Promise<void>
  session?: { delete?: (topic: string, reason: { code: number; message: string }) => unknown }
  auth?: { requests?: { getAll?: () => AuthTypes.PendingRequest[] } }
} | undefined {
  return (
    client.engine as {
      signClient?: {
        on?: (name: string, fn: (event: unknown) => void) => void
        events?: { on?: (name: string, fn: (event: unknown) => void) => void }
        ping?: (args: { topic: string }) => Promise<void>
        session?: { delete?: (topic: string, reason: { code: number; message: string }) => unknown }
        auth?: { requests?: { getAll?: () => AuthTypes.PendingRequest[] } }
      }
    }
  ).signClient
}

function eventTopic(event: unknown): string {
  if (typeof event === 'string') return event.trim()
  if (!event || typeof event !== 'object') return ''
  const row = event as { topic?: string; params?: { topic?: string } }
  return String(row.topic || row.params?.topic || '').trim()
}

const forgettingTopics = new Set<string>()

async function forgetSession(client: Kit, topic: string, source: string): Promise<void> {
  if (!topic) {
    broadcastSessions()
    return
  }
  if (forgettingTopics.has(topic)) return
  forgettingTopics.add(topic)
  try {
    const session = client.getActiveSessions()[topic] as { pairingTopic?: string } | undefined
    if (!session) {
      lastSessionKey = sessionsKey(client)
      broadcastSessions()
      console.log('[walletconnect] 会话已不在列表', source, topic.slice(0, 16))
      return
    }
    try {
      await client.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') })
    } catch {
      try {
        signClientOf(client)?.session?.delete?.(topic, getSdkError('USER_DISCONNECTED'))
      } catch {
        /* 本地已经没有这条会话 */
      }
    }
    // 会话授权已撤销；保留配对通道，网站才能在此通道上发起新的连接提案。
    broadcastSessions()
    lastSessionKey = sessionsKey(client)
    console.log('[walletconnect] 已清理会话', source, topic.slice(0, 16))
  } finally {
    forgettingTopics.delete(topic)
  }
}

function onRemoteSessionGone(event: unknown, source: string): void {
  const topic = eventTopic(event)
  console.log('[walletconnect] 收到网站断开', source, topic.slice(0, 16) || String(event))
  if (!kit) {
    broadcastSessions()
    return
  }
  // SDK 已处理远端删除/过期事件，不再回发 disconnect 或删除共享配对。
  lastSessionKey = sessionsKey(kit)
  broadcastSessions()
}

let sessionPoll: ReturnType<typeof setInterval> | null = null
let lastSessionKey = ''

function sessionsKey(client: Kit): string {
  return Object.keys(client.getActiveSessions()).sort().join(',')
}

function watchSessionList(client: Kit): void {
  if (sessionPoll) return
  lastSessionKey = sessionsKey(client)
  sessionPoll = setInterval(() => {
    drainPendingSessionRequests(client)
    const next = sessionsKey(client)
    if (next === lastSessionKey) return
    console.log('[walletconnect] 会话列表已变化', lastSessionKey || '(空)', '->', next || '(空)')
    lastSessionKey = next
    broadcastSessions()
  }, 3_000)
}

function listPendingAuthRequests(client: Kit): AuthTypes.PendingRequest[] {
  try {
    return signClientOf(client)?.auth?.requests?.getAll?.() ?? []
  } catch {
    return []
  }
}

function listPendingSessionRequests(client: Kit): WalletKitTypes.SessionRequest[] {
  const fromKit = (client as { getPendingSessionRequests?: () => WalletKitTypes.SessionRequest[] }).getPendingSessionRequests
  if (typeof fromKit === 'function') {
    try {
      return fromKit.call(client) ?? []
    } catch {
      /* 个别版本方法签名不同 */
    }
  }
  try {
    return (
      (
        signClientOf(client) as
          | { pendingRequest?: { getAll?: () => WalletKitTypes.SessionRequest[] } }
          | undefined
      )?.pendingRequest?.getAll?.() ?? []
    )
  } catch {
    return []
  }
}

function listHistorySessionRequests(client: Kit): WalletKitTypes.SessionRequest[] {
  const history = client.core as {
    history?: { getAll?: (filter?: { topic?: string }) => unknown[] }
  }
  let records: unknown[] = []
  try {
    records = history.history?.getAll?.() ?? []
  } catch {
    return []
  }
  const now = Math.floor(Date.now() / 1000)
  const out: WalletKitTypes.SessionRequest[] = []
  for (const item of records) {
    if (!item || typeof item !== 'object') continue
    const row = item as {
      id?: number
      topic?: string
      expiry?: number
      response?: unknown
      request?: {
        method?: string
        params?: { request?: { method: string; params?: unknown[] }; chainId?: string }
      }
    }
    if (row.response) continue
    if (row.expiry && row.expiry < now) continue
    if (row.request?.method !== 'wc_sessionRequest') continue
    const method = row.request.params?.request?.method
    if (!method || READ.has(method)) continue
    const id = Number(row.id || 0)
    const topic = String(row.topic || '')
    const params = row.request.params
    if (!id || !topic || !params?.request) continue
    out.push({ id, topic, params } as WalletKitTypes.SessionRequest)
  }
  return out
}

function drainPendingSessionRequests(client: Kit): void {
  const seen = new Set<string>()
  const events = [...listPendingSessionRequests(client), ...listHistorySessionRequests(client)]
  for (const event of events) {
    const id = Number(event.id)
    const requestKey = `${event.topic}:${id}`
    if (!id || seen.has(requestKey) || handledRequestIds.has(requestKey)) continue
    seen.add(requestKey)
    console.log('[walletconnect] 收到待处理 session_request', event.params?.request?.method, id)
    void onRequest(event)
  }
}

function drainPendingAuthentications(client: Kit): void {
  for (const item of listPendingAuthRequests(client)) {
    const id = Number(item.id)
    if (!id || !noteSessionEvent('auth', id)) continue
    console.log('[walletconnect] 收到待处理 session_authenticate', item.requester.metadata.url, id)
    void onAuthenticate({
      id,
      topic: item.pairingTopic,
      params: {
        requester: item.requester,
        authPayload: item.authPayload,
        expiryTimestamp: item.expiryTimestamp,
      },
    } as WalletKitTypes.SessionAuthenticate)
  }
}

function proposalAuthRequests(proposal: WalletKitTypes.SessionProposal): AuthTypes.PayloadParams[] {
  return (proposal.params as { requests?: { authentication?: AuthTypes.PayloadParams[] } }).requests?.authentication ?? []
}

function pickAuthIss(chains: string[], address: string): string {
  const current = currentNetwork()
  const preferred = current ? toCaipChain(current.chainId) : ''
  const chain = preferred && chains.includes(preferred) ? preferred : chains[0]
  return `${chain}:${address}`
}

async function confirmLogin(meta: { url?: string; name?: string }, context?: Verify.Context): Promise<boolean> {
  return confirm({
    kind: 'auth',
    origin: meta.url || meta.name || '',
    name: meta.name || meta.url || 'DApp',
    method: 'session_authenticate',
    verification: verificationStatus(context),
    detail: `${meta.url || ''}\n网站要求签名登录，确认后页面才会显示已连接。`.trim(),
  })
}

async function signAuthCacao(authPayload: AuthTypes.PayloadParams | AuthTypes.PayloadParams): Promise<AuthTypes.Cacao> {
  const client = kit
  if (!client) throw new Error('WalletConnect 未就绪')
  const account = requireEvmAccount()
  const row = getAccountRow(account.id)
  if (!row) throw new Error('账户不存在')
  const chains = authPayload.chains.filter((item) => item.startsWith('eip155:'))
  if (!chains.length) throw new Error('网站没有给出可登录的 EVM 链')
  const payload = populateAuthPayload({
    authPayload: {
      ...authPayload,
      version: authPayload.version || '1',
      iat: authPayload.iat || new Date().toISOString(),
    },
    chains,
    methods: [
      'personal_sign',
      'eth_signTypedData',
      'eth_signTypedData_v3',
      'eth_signTypedData_v4',
      'eth_signTransaction',
      'eth_sendTransaction',
    ],
  })
  const iss = pickAuthIss(chains, account.address)
  const message = client.formatAuthMessage({ request: payload, iss })
  const signature = withAccountPrivateKey(row, (key) => personalSign(key, message))
  return buildAuthObject(payload, { t: 'eip191', s: signature }, iss)
}

function drainPendingProposals(client: Kit): void {
  try {
    const latest = new Map<string, { id: number; params: ReturnType<Kit['getPendingSessionProposals']>[number] }>()
    const stale: number[] = []
    for (const params of Object.values(client.getPendingSessionProposals())) {
      const proposalId = Number(params.id)
      if (!proposalId) continue
      const origin = peerOrigin(params.proposer.metadata.url)
      const prev = latest.get(origin)
      if (!prev || proposalId > prev.id) {
        if (prev) stale.push(prev.id)
        latest.set(origin, { id: proposalId, params })
      } else {
        stale.push(proposalId)
      }
    }
    for (const id of stale) {
      handledSessionIds.add(id)
      void rejectProposal(client, id)
    }
    if (stale.length) console.log('[walletconnect] 已丢掉同一网站的旧提案', stale.length)
    for (const { id, params } of latest.values()) {
      const pairingTopic = pairingTopicOf(params)
      if (!isCurrentPairingTopic(pairingTopic)) continue
      if (!noteSessionEvent('proposal', id)) continue
      console.log(
        '[walletconnect] 收到待处理 session_proposal',
        params.proposer.metadata.url,
        id,
        (params as { requests?: { authentication?: unknown[] } }).requests?.authentication?.length ? '含登录' : '',
      )
      void onProposal({ id, params } as WalletKitTypes.SessionProposal)
    }
  } catch {
    /* 个别 WalletKit 版本没有待处理列表 */
  }
}

function attachSessionListeners(next: Kit): void {
  const onProposalEvent = (proposal: WalletKitTypes.SessionProposal) => {
    const pairingTopic = pairingTopicOf(proposal.params)
    if (!isCurrentPairingTopic(pairingTopic)) {
      console.log('[walletconnect] 忽略旧配对的提案', pairingTopic.slice(0, 16) || '(空)')
      if (pairingTopic) {
        handledSessionIds.add(proposal.id)
        void rejectProposal(next, proposal.id)
      }
      return
    }
    if (!noteSessionEvent('proposal', proposal.id)) return
    console.log(
      '[walletconnect] 收到 session_proposal',
      proposal.params.proposer.metadata.url,
      pairingTopic,
      proposalAuthRequests(proposal).length ? '含登录' : '无登录',
    )
    void onProposal(proposal)
  }
  const onAuthEvent = (event: WalletKitTypes.SessionAuthenticate) => {
    const pairingTopic = pairingTopicOf(event as { pairingTopic?: string; topic?: string })
    if (expectedPairingTopic && pairingTopic && pairingTopic !== expectedPairingTopic) {
      console.log('[walletconnect] 忽略旧配对的登录', pairingTopic.slice(0, 16))
      handledSessionIds.add(event.id)
      void next.rejectSessionAuthenticate({ id: event.id, reason: getSdkError('USER_REJECTED') }).catch(() => undefined)
      return
    }
    if (!noteSessionEvent('auth', event.id)) return
    console.log('[walletconnect] 收到 session_authenticate', event.params.requester.metadata.url)
    void onAuthenticate(event)
  }
  const onRequestEvent = (event: WalletKitTypes.SessionRequest) => {
    void onRequest(event)
  }
  next.on('session_proposal', onProposalEvent)
  next.on('session_authenticate', onAuthEvent)
  next.on('session_request', onRequestEvent)
  next.on('session_delete', (event) => onRemoteSessionGone(event, 'walletkit'))
  const signClient = signClientOf(next)
  signClient?.on?.('session_proposal', (event) => onProposalEvent(event as WalletKitTypes.SessionProposal))
  signClient?.on?.('session_authenticate', (event) => onAuthEvent(event as WalletKitTypes.SessionAuthenticate))
  signClient?.on?.('session_request', (event) => onRequestEvent(event as WalletKitTypes.SessionRequest))
  signClient?.on?.('session_delete', (event) => onRemoteSessionGone(event, 'signClient'))
  signClient?.on?.('session_expire', (event) => onRemoteSessionGone(event, 'expire'))
  signClient?.events?.on?.('session_request', (event) => onRequestEvent(event as WalletKitTypes.SessionRequest))
  signClient?.events?.on?.('session_delete', (event) => onRemoteSessionGone(event, 'signClient.events'))
  signClient?.events?.on?.('session_expire', (event) => onRemoteSessionGone(event, 'expire.events'))
  const kitEvents = (next as unknown as { events?: { on?: (name: string, fn: (event: unknown) => void) => void } }).events
  kitEvents?.on?.('session_request', (event) => onRequestEvent(event as WalletKitTypes.SessionRequest))
  kitEvents?.on?.('session_delete', (event) => onRemoteSessionGone(event, 'walletkit.events'))
  const engine = next.engine as { on?: (name: string, fn: (event: unknown) => void) => void }
  engine?.on?.('session_request', (event) => onRequestEvent(event as WalletKitTypes.SessionRequest))
  engine?.on?.('session_delete', (event) => onRemoteSessionGone(event, 'engine'))
  console.log('[walletconnect] 已监听网站断开')
}

function focusWalletWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function proposalIdOf(proposal: WalletKitTypes.SessionProposal): number {
  return Number(proposal.id || proposal.params.id)
}

async function rejectProposal(client: Kit, id: number): Promise<void> {
  if (!id) return
  try {
    await client.rejectSession({ id, reason: getSdkError('USER_REJECTED') })
  } catch (err) {
    console.warn('[walletconnect] 拒绝会话失败', err instanceof Error ? err.message : err)
  }
}

async function onProposal(proposal: WalletKitTypes.SessionProposal): Promise<void> {
  const client = kit
  if (!client) return
  const proposalId = proposalIdOf(proposal)
  if (!proposalId) {
    console.warn('[walletconnect] 连接请求缺少提案 id，已忽略')
    return
  }
  const meta = proposal.params.proposer.metadata
  const approved = await confirm({
    kind: 'session',
    origin: meta.url || meta.name,
    name: meta.name || meta.url || 'DApp',
    method: 'session_propose',
    verification: verificationStatus(proposal.verifyContext),
    detail: describeSessionProposal({
      url: meta.url,
      requiredNamespaces: proposal.params.requiredNamespaces,
      optionalNamespaces: proposal.params.optionalNamespaces,
    }),
  })
  if (!approved) {
    await rejectProposal(client, proposalId)
    if (expectedPairingTopic === pairingTopicOf(proposal.params)) expectedPairingTopic = null
    return
  }
  try {
    const account = requireEvmAccount()
    const evmNetworks = listNetworks().filter((item) => item.walletType === 'web3' && item.chainId)
    const requested = [
      ...(proposal.params.requiredNamespaces?.eip155?.chains ?? []),
      ...(proposal.params.optionalNamespaces?.eip155?.chains ?? []),
    ]
    const chains = [...new Set([...evmNetworks.map((item) => toCaipChain(item.chainId)), ...requested])]
    const accounts = chains.map((chain) => `${chain}:${account.address}`)
    if (!chains.length) throw new Error('目录里没有可授权的 EVM 网络')
    const namespaces = buildApprovedNamespaces({
      proposal: proposal.params,
      supportedNamespaces: {
        eip155: {
          chains,
          methods: METHODS,
          events: ['accountsChanged', 'chainChanged'],
          accounts,
        },
      },
    })
    const embeddedAuth = proposalAuthRequests(proposal)
    let cacao: AuthTypes.Cacao | undefined
    if (embeddedAuth[0]) {
      console.log('[walletconnect] 提案里带了登录请求，请再确认一次')
      const loginOk = await confirmLogin(meta, proposal.verifyContext)
      if (!loginOk) {
        await rejectProposal(client, proposalId)
        if (expectedPairingTopic === pairingTopicOf(proposal.params)) expectedPairingTopic = null
        return
      }
      cacao = await signAuthCacao(embeddedAuth[0])
    }
    console.log('[walletconnect] 正在批准会话', proposalId, Object.keys(namespaces), cacao ? '含登录签名' : '')
    const session = await client.approveSession({
      id: proposalId,
      namespaces,
      sessionProperties: proposal.params.sessionProperties,
    })
    await disconnectOtherSessions(client, meta.url, session.topic)
    expectedPairingTopic = null
    broadcastSessions()
    void notifyWalletConnectNetwork()
    console.log('[walletconnect] 会话已批准', meta.url, session.topic)
    drainPendingAuthentications(client)
    drainPendingSessionRequests(client)
  } catch (err) {
    console.warn('[walletconnect] 批准会话失败', err instanceof Error ? err.message : err)
    await rejectProposal(client, proposalId)
    if (expectedPairingTopic === pairingTopicOf(proposal.params)) expectedPairingTopic = null
  }
}

async function onAuthenticate(event: WalletKitTypes.SessionAuthenticate): Promise<void> {
  const client = kit
  if (!client) return
  const meta = event.params.requester.metadata
  const approved = await confirmLogin(meta, event.verifyContext)
  if (!approved) {
    await client.rejectSessionAuthenticate({ id: event.id, reason: getSdkError('USER_REJECTED') })
    return
  }
  try {
    const cacao = await signAuthCacao(event.params.authPayload)
    const result = await client.approveSessionAuthenticate({ id: event.id, auths: [cacao] })
    const topic = result && typeof result === 'object' && 'session' in result ? result.session?.topic : undefined
    await disconnectOtherSessions(client, meta.url, topic)
    broadcastSessions()
    console.log('[walletconnect] 登录已批准', meta.url, topic || '')
  } catch (err) {
    await client.rejectSessionAuthenticate({ id: event.id, reason: getSdkError('USER_REJECTED') })
    console.warn('[walletconnect] 批准登录失败', err instanceof Error ? err.message : err)
  }
}

async function onRequest(event: WalletKitTypes.SessionRequest): Promise<void> {
  const client = kit
  if (!client) return
  const { topic, id, params } = event
  const requestKey = `${event.topic}:${id}`
  if (!id || handledRequestIds.has(requestKey)) return
  handledRequestIds.add(requestKey)
  setTimeout(() => handledRequestIds.delete(requestKey), 10_000)
  const method = params.request.method
  const requestParams = Array.isArray(params.request.params) ? params.request.params : []
  const session = client.getActiveSessions()[topic]
  console.log('[walletconnect] 收到 session_request', method, session?.peer.metadata.url || topic.slice(0, 16), id)
  if (!session) {
    console.log('[walletconnect] 请求对应的会话已不存在', topic.slice(0, 16))
    try {
      await client.respondSessionRequest({
        topic,
        response: { id, jsonrpc: '2.0', error: { code: 5900, message: 'session gone' } },
      })
    } catch {
      /* 会话已经没了 */
    }
    void forgetSession(client, topic, 'missing')
    return
  }
  const origin = session.peer.metadata.url || session.peer.metadata.name || topic
  try {
    if (!getStatus().unlocked) throw new Error('请先解锁钱包')
    if (READ.has(method)) {
      const result = await handleRead(method, requestParams, params.chainId)
      await client.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } })
      return
    }
    const approved = await confirm({
      kind: pendingKind(method),
      origin,
      name: session.peer.metadata.name || origin,
      method,
      detail: describeWcRequest(method, requestParams),
      verification: verificationStatus(event.verifyContext),
    })
    if (!approved) throw new Error('用户拒绝')
    const result = await handleWrite(method, requestParams, params.chainId)
    await client.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[walletconnect] 处理 session_request 失败', method, message)
    await client.respondSessionRequest({
      topic,
      response: {
        id,
        jsonrpc: '2.0',
        error: { code: message === '用户拒绝' ? 5000 : -32603, message },
      },
    })
  }
}

async function handleRead(method: string, params: unknown[], caipChain: string): Promise<unknown> {
  const account = requireEvmAccount()
  if (method === 'eth_accounts' || method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
    return method === 'wallet_requestPermissions' ? [{ parentCapability: 'eth_accounts' }] : [account.address]
  }
  if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }]
  if (method === 'wallet_getCapabilities') {
    const catalog = listNetworks()
      .filter((item) => item.walletType === 'web3' && item.chainId)
      .map((item) => item.chainId)
    return walletCapabilities(params, [caipChain, ...catalog])
  }
  if (method === 'wallet_getCallsStatus') {
    return getCallsStatus(String(params[0] ?? ''))
  }
  if (method === 'wallet_showCallsStatus') return null
  if (method === 'eth_chainId' || method === 'net_version') {
    const network = networkFromCaip(caipChain) ?? currentNetwork()
    if (!network) throw new Error('请先选择 EVM 网络')
    const decimal = chainIdDecimal(network.chainId)
    return method === 'net_version' ? decimal : toHexChainId(decimal)
  }
  const network = networkFromCaip(caipChain) ?? currentNetwork()
  if (!network) throw new Error('当前链不在目录里')
  return evmRpc(network, method, params)
}

async function sendCallsBatch(params: unknown[], caipChain: string): Promise<{ id: string }> {
  const input = (params[0] ?? {}) as {
    chainId?: string
    atomicRequired?: boolean
    calls?: { to?: string; data?: string; value?: string }[]
  }
  const calls = Array.isArray(input.calls) ? input.calls : []
  if (!calls.length) throw new Error('缺少交易')
  if (input.atomicRequired && calls.length > 1) throw new Error('不支持原子批量交易')
  const chain = input.chainId ? toCaipChain(input.chainId) : caipChain
  const hashes: string[] = []
  for (const call of calls) {
    hashes.push(String(await handleWrite('eth_sendTransaction', [call], chain)))
  }
  const id = hashes[0]
  sendCallRecords.set(id, { chainId: toHexChainId(chain), hashes })
  return { id }
}

async function getCallsStatus(id: string): Promise<unknown> {
  const row = sendCallRecords.get(id)
  if (!row) throw new Error('找不到这笔批量交易')
  const network = networkFromCaip(toCaipChain(row.chainId)) ?? currentNetwork()
  const receipts: unknown[] = []
  let pending = false
  for (const hash of row.hashes) {
    let receipt: { blockNumber?: string; transactionHash?: string } | null = null
    if (network) {
      try {
        receipt = (await evmRpc(network, 'eth_getTransactionReceipt', [hash])) as {
          blockNumber?: string
          transactionHash?: string
        } | null
      } catch {
        receipt = null
      }
    }
    if (!receipt?.blockNumber) pending = true
    receipts.push(receipt ?? { transactionHash: hash, status: '0x1' })
  }
  return {
    version: '2.0.0',
    id,
    chainId: row.chainId,
    atomic: false,
    status: pending ? 100 : 200,
    receipts,
  }
}

async function handleWrite(method: string, params: unknown[], caipChain: string): Promise<unknown> {
  const account = requireEvmAccount()
  const row = getAccountRow(account.id)
  if (!row) throw new Error('账户不存在')
  if (method === 'personal_sign' || method === 'eth_sign') {
    const message = method === 'eth_sign' ? String(params[1] ?? '') : personalMessage(params)
    return withAccountPrivateKey(row, (key) => personalSign(key, message))
  }
  if (method.startsWith('eth_signTypedData')) {
    const typed = parseTyped(params)
    const digest = hashTypedData(typed)
    return withAccountPrivateKey(row, (key) => {
      const sig = secp256k1.sign(hexToBytes(digest.slice(2)), key, { prehash: false })
      return `${bytesToHex(sig.toBytes('compact'))}${(sig.recovery + 27).toString(16).padStart(2, '0')}`
    })
  }
  if (method === 'wallet_sendCalls') return sendCallsBatch(params, caipChain)
  if (method === 'wallet_watchAsset' || method === 'wallet_showCallsStatus') return true
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
    const raw = (params[0] as { chainId?: string } | undefined)?.chainId
    if (!raw) throw new Error('缺少 chainId')
    const network = findNetworkByChain('web3', chainIdDecimal(raw))
    if (!network) throw new Error(`目录里没有这条链：${raw}`)
    saveSettings({ defaultNetworkPk: network.id })
    void notifyWalletConnectNetwork()
    return null
  }
  if (method !== 'eth_sendTransaction') throw new Error(`不支持 ${method}`)
  const tx = (params[0] ?? {}) as {
    to?: string
    data?: string
    value?: string
    gas?: string
    gasLimit?: string
  }
  const network = networkFromCaip(caipChain) ?? currentNetwork()
  if (!network) throw new Error('当前链不在目录里')
  const value = tx.value ? BigInt(tx.value) : 0n
  const data = (tx.data || '0x') as Hex
  const nonce = await getEvmNonce(network, account.address)
  const fee = (await quoteEvmFees(network)).medium
  const gasLimit = tx.gas || tx.gasLimit
    ? BigInt(tx.gas || tx.gasLimit || '0')
    : await estimateEvmGas({ network, from: account.address, to: tx.to, data, value })
  const keyCopy = withAccountPrivateKey(row, (key) => Uint8Array.from(key))
  try {
    const signed = await signAndSerializeEvmTx({
      privateKey: keyCopy,
      chainId: Number(chainIdDecimal(network.chainId)),
      nonce,
      to: tx.to,
      value,
      data,
      gasLimit,
      fee,
    })
    return broadcastEvmTx(network, signed.hex)
  } finally {
    keyCopy.fill(0)
  }
}

function personalMessage(params: unknown[]): string {
  const first = String(params[0] ?? '')
  const second = String(params[1] ?? '')
  const payload = first.startsWith('0x') && second.startsWith('0x') && first.length > 42 ? first : first.startsWith('0x') ? first : second
  return hexToUtf8(payload)
}

function parseTyped(params: unknown[]): TypedDataDefinition {
  const raw = params.find((item) => typeof item === 'string' && item.trim().startsWith('{'))
  if (typeof raw !== 'string') throw new Error('缺少 typed data')
  // 必须保留网站提供的 EIP712Domain。JSON-RPC 的 chainId 常是字符串，
  // 删除显式类型后 viem 自动推断会漏掉 chainId，导致 Permit2 签错摘要。
  return JSON.parse(raw) as TypedDataDefinition
}

function currentEvmAccount(): AccountRecord | null {
  const wallet = getCurrentWallet()
  if (!wallet) return null
  const network = currentNetwork()
  const accounts = listAccounts(wallet.id).filter((item) => item.walletType === 'web3')
  return accounts.find((item) => item.networkScope === network?.networkScope) ?? accounts[0] ?? null
}

function requireEvmAccount(): AccountRecord {
  const account = currentEvmAccount()
  if (!account) throw new Error('请先创建或选择带 EVM 账户的钱包')
  return account
}

function currentNetwork(): NetworkRecord | null {
  const pk = loadSettings().defaultNetworkPk
  const network = pk ? getNetwork(pk) : null
  return network?.walletType === 'web3' ? network : null
}

function networkFromCaip(caipChain: string): NetworkRecord | null {
  try {
    return findNetworkByChain('web3', chainIdDecimal(caipChain))
  } catch {
    return null
  }
}

function confirm(draft: Omit<WalletConnectPending, 'id'>): Promise<boolean> {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const item: WalletConnectPending = { ...draft, id }
  return new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      broadcastPending()
      reject(new Error('请求已超时'))
    }, 5 * 60_000)
    pending.set(id, { item, resolve, reject, timer })
    focusWalletWindow()
    broadcast(IPC_EVENT.walletConnectRequest, item)
    broadcastPending()
  })
}

function broadcastSessions(): void {
  broadcast(IPC_EVENT.walletConnectSessions, listWalletConnectSessions())
}

function broadcastPending(): void {
  broadcast(IPC_EVENT.walletConnectPending, listWalletConnectPending())
}
