/**
 * WalletConnect 钱包端：配对、确认、签名/发交易、断开。密钥不离开主进程。
 */
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { WalletKitTypes } from '@reown/walletkit'
import type { AuthTypes } from '@walletconnect/types'
import { installWalletConnectWebSocket } from './installWs'
import { buildApprovedNamespaces, buildAuthObject, getSdkError, populateAuthPayload } from '@walletconnect/utils'
import { bytesToHex, hashTypedData, type Hex, type TypedDataDefinition } from 'viem'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hexToBytes } from '@noble/hashes/utils'
import type {
  AccountRecord,
  NetworkRecord,
  WalletConnectPending,
  WalletConnectSession,
  WalletConnectStatus,
} from '@shared/types'
import { IPC_EVENT } from '../../../shared/ipc'
import { findNetworkByChain, getNetwork, listNetworks } from '../db/repos/catalogRepo'
import { getAccountRow } from '../db/repos/accountRepo'
import { loadSettings, saveSettings } from '../db/repos/metaRepo'
import { broadcast } from '../ipc/registry'
import { invalidArg } from '../ipc/registry'
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
import {
  chainIdDecimal,
  describeSessionProposal,
  describeWcRequest,
  hexToUtf8,
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
  'net_version',
])

let kit: Kit | null = null
let starting: Promise<Kit> | null = null
let pairLock: Promise<void> | null = null
const activePairings = new Map<string, Promise<void>>()
const usedUris = new Set<string>()
const handledSessionIds = new Set<number>()
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

export async function startWalletConnect(): Promise<Kit | null> {
  if (kit) return kit
  if (starting) return starting
  const projectId = walletConnectProjectId()
  if (!projectId) return null
  starting = (async () => {
    installWalletConnectWebSocket()
    process.env.DISABLE_GLOBAL_CORE = 'true'
    const { Core } = await import('@walletconnect/core')
    const { WalletKit } = await import('@reown/walletkit')
    const core = new Core({
      projectId,
      relayUrl: walletConnectRelayUrl(),
      customStoragePrefix: 'bee-wallet',
      storage: createFileKeyValueStorage(path.join(app.getPath('userData'), 'walletconnect.json')),
    })
    const next = await WalletKit.init({
      core,
      metadata: {
        name: 'Bee Wallet Lab',
        description: '本地优先的多链实验钱包',
        url: 'https://github.com/ldlqdsdcn/bee-wallet-lab',
        icons: [],
      },
    })
    attachSessionListeners(next)
    next.on('session_request', (event) => {
      void onRequest(event)
    })
    next.on('session_delete', () => broadcastSessions())
    next.on('proposal_expire', () => {
      console.warn('[walletconnect] 连接请求已过期。请在网站上重新打开 WalletConnect，立刻复制新链接。')
    })
    try {
      if (!next.core.relayer.connected) await next.core.relayer.transportOpen()
    } catch (err) {
      console.warn('[walletconnect] 中继尚未连通', err instanceof Error ? err.message : err)
    }
    discardLeftoverProposals(next)
    discardLeftoverAuthentications(next)
    kit = next
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
  if (!getStatus().unlocked) throw invalidArg('请先解锁钱包')
  if (pairLock || activePairings.size) {
    throw invalidArg('上一次连接还在进行。请先确认弹窗，不要连贴第二条链接，否则网站会停在旧二维码上。')
  }
  if ([...pending.values()].some((item) => item.item.kind === 'session' || item.item.kind === 'auth')) {
    throw invalidArg('请先确认当前弹窗，再连接下一个网站。')
  }
  const client = await requireKit()
  const parsed = parseWalletConnectUri(uri)
  if (!parsed.includes('symKey=')) {
    throw invalidArg('链接不完整，缺少 symKey。请复制二维码下方以 wc: 开头的整段链接。')
  }
  if (usedUris.has(parsed)) {
    throw invalidArg('这个链接已经用过。请关掉网站上的 WalletConnect 窗口，重新点一次，立刻复制新链接。')
  }
  const active = activePairings.get(parsed)
  if (active) {
    await active
    return listWalletConnectSessions()
  }

  const pairing = (async () => {
    try {
      if (!client.core.relayer.connected) await client.core.relayer.transportOpen()
    } catch {
      /* pair 里还会再连一次 */
    }
    lastIncomingSession = null
    console.log('[walletconnect] 开始配对', {
      chars: parsed.length,
      hasSymKey: parsed.includes('symKey='),
      topic: parsed.slice(3, parsed.indexOf('@') > 0 ? parsed.indexOf('@') : 19),
    })
    await client.pair({ uri: parsed, activatePairing: true })
    usedUris.add(parsed)
    console.log('[walletconnect] 配对请求已交给中继，等待网站确认')
    const alreadyOpen = lastIncomingSession || [...pending.values()].some((item) => item.item.kind === 'session' || item.item.kind === 'auth')
    if (!alreadyOpen) {
      try {
        await waitForIncomingSession(20_000)
      } catch (err) {
        drainPendingProposals(client)
        drainPendingAuthentications(client)
        if (!lastIncomingSession && ![...pending.values()].some((item) => item.item.kind === 'session' || item.item.kind === 'auth')) {
          throw err
        }
      }
    }
  })()
  pairLock = pairing
  activePairings.set(parsed, pairing)
  try {
    await pairing
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/subscribing/i.test(message) || /please try again/i.test(message)) {
      throw invalidArg('连不上 WalletConnect 中继。直连 relay.walletconnect.com 会超时，请先在设置里打开代理后再配对')
    }
    throw err
  } finally {
    if (activePairings.get(parsed) === pairing) activePairings.delete(parsed)
    if (pairLock === pairing) pairLock = null
  }
  return listWalletConnectSessions()
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
  await client.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') })
  broadcastSessions()
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

function waitForIncomingSession(ms: number): Promise<'proposal' | 'auth'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sessionWaiters.delete(onEvent)
      reject(
        invalidArg(
          '网站没有发来连接请求。请关掉网站上的 WalletConnect 窗口，重新点一次，立刻复制最新的完整 wc: 链接（旧链接只能用一次）。',
        ),
      )
    }, ms)
    const onEvent = (kind: 'proposal' | 'auth') => {
      clearTimeout(timer)
      sessionWaiters.delete(onEvent)
      resolve(kind)
    }
    sessionWaiters.add(onEvent)
  })
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

function discardLeftoverProposals(client: Kit): void {
  try {
    const leftovers = Object.values(client.getPendingSessionProposals())
    for (const params of leftovers) {
      const id = Number(params.id)
      if (!id) continue
      handledSessionIds.add(id)
      void rejectProposal(client, id)
    }
    if (leftovers.length) console.log('[walletconnect] 已清理启动时遗留的连接请求', leftovers.length)
  } catch {
    /* 没有遗留提案就跳过 */
  }
}

function signClientOf(client: Kit): {
  auth?: { requests?: { getAll?: () => AuthTypes.PendingRequest[] } }
} | undefined {
  return (client.engine as { signClient?: { auth?: { requests?: { getAll?: () => AuthTypes.PendingRequest[] } } } }).signClient
}

function listPendingAuthRequests(client: Kit): AuthTypes.PendingRequest[] {
  try {
    return signClientOf(client)?.auth?.requests?.getAll?.() ?? []
  } catch {
    return []
  }
}

function discardLeftoverAuthentications(client: Kit): void {
  const leftovers = listPendingAuthRequests(client)
  for (const item of leftovers) {
    const id = Number(item.id)
    if (!id) continue
    handledSessionIds.add(id)
    void client.rejectSessionAuthenticate({ id, reason: getSdkError('USER_REJECTED') }).catch(() => undefined)
  }
  if (leftovers.length) console.log('[walletconnect] 已清理启动时遗留的登录请求', leftovers.length)
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

function proposalAuthRequests(proposal: WalletKitTypes.SessionProposal): AuthTypes.AuthenticateParams[] {
  return proposal.params.requests?.authentication ?? []
}

function pickAuthIss(chains: string[], address: string): string {
  const current = currentNetwork()
  const preferred = current ? toCaipChain(current.chainId) : ''
  const chain = preferred && chains.includes(preferred) ? preferred : chains[0]
  return `${chain}:${address}`
}

async function confirmLogin(meta: { url?: string; name?: string }): Promise<boolean> {
  return confirm({
    kind: 'auth',
    origin: meta.url || meta.name || '',
    name: meta.name || meta.url || 'DApp',
    method: 'session_authenticate',
    detail: `${meta.url || ''}\n网站要求签名登录，确认后页面才会显示已连接。`.trim(),
  })
}

async function signAuthCacao(authPayload: AuthTypes.PayloadParams | AuthTypes.AuthenticateParams): Promise<AuthTypes.Cacao> {
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

async function waitForPendingAuth(client: Kit, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    drainPendingAuthentications(client)
    if ([...pending.values()].some((item) => item.item.kind === 'auth')) return
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
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
      if (!noteSessionEvent('proposal', id)) continue
      console.log(
        '[walletconnect] 收到待处理 session_proposal',
        params.proposer.metadata.url,
        id,
        params.requests?.authentication?.length ? '含登录' : '',
      )
      void onProposal({ id, params } as WalletKitTypes.SessionProposal)
    }
  } catch {
    /* 个别 WalletKit 版本没有待处理列表 */
  }
}

function attachSessionListeners(next: Kit): void {
  const onProposalEvent = (proposal: WalletKitTypes.SessionProposal) => {
    if (!noteSessionEvent('proposal', proposal.id)) return
    console.log(
      '[walletconnect] 收到 session_proposal',
      proposal.params.proposer.metadata.url,
      proposal.params.pairingTopic || '',
      proposalAuthRequests(proposal).length ? '含登录' : '无登录',
    )
    void onProposal(proposal)
  }
  const onAuthEvent = (event: WalletKitTypes.SessionAuthenticate) => {
    if (!noteSessionEvent('auth', event.id)) return
    console.log('[walletconnect] 收到 session_authenticate', event.params.requester.metadata.url)
    void onAuthenticate(event)
  }
  next.on('session_proposal', onProposalEvent)
  next.on('session_authenticate', onAuthEvent)
  const signClient = (next.engine as unknown as { signClient?: { on: (name: string, fn: (event: unknown) => void) => void } }).signClient
  signClient?.on('session_proposal', (event) => onProposalEvent(event as WalletKitTypes.SessionProposal))
  signClient?.on('session_authenticate', (event) => onAuthEvent(event as WalletKitTypes.SessionAuthenticate))
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
    detail: describeSessionProposal({
      url: meta.url,
      requiredNamespaces: proposal.params.requiredNamespaces,
      optionalNamespaces: proposal.params.optionalNamespaces,
    }),
  })
  if (!approved) {
    await rejectProposal(client, proposalId)
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
      const loginOk = await confirmLogin(meta)
      if (!loginOk) {
        await rejectProposal(client, proposalId)
        return
      }
      cacao = await signAuthCacao(embeddedAuth[0])
    }
    console.log('[walletconnect] 正在批准会话', proposalId, Object.keys(namespaces), cacao ? '含登录签名' : '')
    const session = await client.approveSession({
      id: proposalId,
      namespaces,
      sessionProperties: proposal.params.sessionProperties,
      proposalRequestsResponses: cacao ? { authentication: [cacao] } : undefined,
    })
    await disconnectOtherSessions(client, meta.url, session.topic)
    broadcastSessions()
    void notifyWalletConnectNetwork()
    console.log('[walletconnect] 会话已批准', meta.url, session.topic)
    if (!cacao) {
      console.log('[walletconnect] 等待网站登录请求，请再确认一次')
      drainPendingAuthentications(client)
      await waitForPendingAuth(client, 20_000)
      if (![...pending.values()].some((item) => item.item.kind === 'auth')) {
        console.log('[walletconnect] 网站没有再发登录。若页面仍停在二维码，请关掉窗口后只连一次最新链接')
      }
    }
  } catch (err) {
    console.warn('[walletconnect] 批准会话失败', err instanceof Error ? err.message : err)
    await rejectProposal(client, proposalId)
  }
}

async function onAuthenticate(event: WalletKitTypes.SessionAuthenticate): Promise<void> {
  const client = kit
  if (!client) return
  const meta = event.params.requester.metadata
  const approved = await confirmLogin(meta)
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
  const method = params.request.method
  const requestParams = Array.isArray(params.request.params) ? params.request.params : []
  const session = client.getActiveSessions()[topic]
  const origin = session?.peer.metadata.url || session?.peer.metadata.name || topic
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
      name: session?.peer.metadata.name || origin,
      method,
      detail: describeWcRequest(method, requestParams),
    })
    if (!approved) throw new Error('用户拒绝')
    const result = await handleWrite(method, requestParams, params.chainId)
    await client.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
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
  const parsed = JSON.parse(raw) as TypedDataDefinition & { types?: Record<string, unknown> }
  if (parsed.types && 'EIP712Domain' in parsed.types) {
    const { EIP712Domain: _drop, ...rest } = parsed.types
    return { ...parsed, types: rest } as TypedDataDefinition
  }
  return parsed
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
