import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletKitTypes } from '@reown/walletkit'
import { recoverTypedDataAddress, type Hex, type TypedDataDefinition } from 'viem'

const sdk = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@walletconnect/core', () => ({ Core: vi.fn(() => ({ history: { on: vi.fn() } })) }))
vi.mock('@reown/walletkit', () => ({ WalletKit: { init: async () => sdk.client } }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bee-wc-lifecycle-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('../electron/main/walletconnect/installWs', () => ({ installWalletConnectWebSocket: vi.fn() }))
vi.mock('../electron/main/walletconnect/verify', async (importOriginal) => ({
  ...await importOriginal<typeof import('../electron/main/walletconnect/verify')>(),
  installVerifyFetch: vi.fn(), guardVerifyResolution: vi.fn(),
}))
vi.mock('../electron/main/walletconnect/pairingOverlay', () => ({ applyPairingOverlay: vi.fn() }))
vi.mock('../electron/main/rpc/walletconnectEnv', () => ({
  walletConnectProjectId: () => 'test-project',
  walletConnectRelayUrl: () => 'wss://relay.test',
}))
vi.mock('../electron/main/ipc/registry', () => ({
  broadcast: vi.fn(),
  IpcError: class extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  },
  invalidArg: (message: string) => new Error(message),
}))
vi.mock('../electron/main/i18n', () => ({ t: (key: string) => key }))
vi.mock('../electron/main/security/vault', () => ({ getStatus: () => ({ unlocked: true }) }))
vi.mock('../electron/main/db/repos/catalogRepo', () => ({
  listNetworks: () => [{ id: 1, walletType: 'web3', chainId: '56' }],
  getNetwork: () => ({ id: 1, walletType: 'web3', chainId: '56' }),
  findNetworkByChain: vi.fn(),
}))
vi.mock('../electron/main/db/repos/accountRepo', () => ({ getAccountRow: vi.fn(() => ({ id: 1 })) }))
vi.mock('../electron/main/db/repos/metaRepo', () => ({
  loadSettings: () => ({ defaultNetworkPk: 1 }), saveSettings: vi.fn(),
}))
vi.mock('../electron/main/wallets/service', () => ({
  getCurrentWallet: () => ({ id: 1 }),
  listAccounts: () => [{ id: 1, walletType: 'web3', address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' }],
  withAccountPrivateKey: vi.fn((_row: unknown, fn: (key: Uint8Array) => unknown) => {
    const testKey = new Uint8Array(32)
    testKey[31] = 1
    return fn(testKey)
  }),
}))
vi.mock('../electron/main/chain/evm', () => ({
  broadcastEvmTx: vi.fn(), estimateEvmGas: vi.fn(), evmRpc: vi.fn(),
  getEvmNonce: vi.fn(), quoteEvmFees: vi.fn(), signAndSerializeEvmTx: vi.fn(),
}))
vi.mock('../electron/main/sign/evm', () => ({ personalSign: vi.fn() }))

const uri = (topic: string) => `wc:${topic}@2?relay-protocol=irn&symKey=${'ab'.repeat(32)}`
const metadata = { name: 'PancakeSwap', url: 'https://pancakeswap.finance', description: '', icons: [] }
const session = (topic: string, pairingTopic: string) => ({
  topic, pairingTopic, expiry: Math.floor(Date.now() / 1000) + 3600,
  peer: { metadata }, namespaces: { eip155: { chains: ['eip155:56'], accounts: [] } },
})

function makeClient() {
  const sessions: Record<string, ReturnType<typeof session>> = {}
  const pairings = new Set<string>()
  const proposals: Record<number, WalletKitTypes.SessionProposal['params']> = {}
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  return {
    sessions, pairings, proposals,
    on(name: string, fn: (event: unknown) => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn])
    },
    emit(name: string, event: unknown) { for (const fn of listeners.get(name) ?? []) fn(event) },
    core: {
      relayer: { connected: true, transportOpen: vi.fn(async () => {}), subscribe: vi.fn(async () => {}) },
      pairing: {
        getPairings: () => [...pairings].map((topic) => ({ topic })),
        activate: vi.fn(async () => {}),
        disconnect: vi.fn(async ({ topic }: { topic: string }) => { pairings.delete(topic) }),
      },
    },
    engine: { signClient: { ping: vi.fn(async () => { throw new Error('offline') }) } },
    pair: vi.fn(async ({ uri: value }: { uri: string }) => { pairings.add(value.slice(3, value.indexOf('@'))) }),
    getActiveSessions: () => sessions,
    getPendingSessionProposals: () => proposals,
    getPendingSessionRequests: () => [],
    disconnectSession: vi.fn(async ({ topic }: { topic: string }) => { delete sessions[topic] }),
    rejectSession: vi.fn(async ({ id }: { id: number }) => { delete proposals[id] }),
    approveSession: vi.fn(async ({ id }: { id: number }) => {
      const next = session(`session-${id}`, proposals[id].pairingTopic ?? '')
      sessions[next.topic] = next
      delete proposals[id]
      return next
    }),
    emitSessionEvent: vi.fn(async () => {}),
    respondSessionRequest: vi.fn(async () => {}),
  }
}

let client: ReturnType<typeof makeClient>
let service: typeof import('../electron/main/walletconnect/service')

function propose(topic: string, id = 1) {
  const params = {
    id, pairingTopic: topic, expiryTimestamp: Math.floor(Date.now() / 1000) + 300,
    relays: [{ protocol: 'irn' }], proposer: { publicKey: 'test-key', metadata },
    requiredNamespaces: {}, optionalNamespaces: {
      eip155: { chains: ['eip155:56'], methods: ['eth_sendTransaction'], events: ['accountsChanged', 'chainChanged'] },
    },
  }
  client.proposals[id] = params
  client.emit('session_proposal', { id, params })
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  client = makeClient()
  sdk.client = client
  service = await import('../electron/main/walletconnect/service')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WalletConnect 断开与重连', () => {
  it.each(['1', '0x1', 1])('Permit2 chainId=%s 的签名能按网站原始类型恢复到授权账户', async (chainId) => {
    client.sessions.permit = session('permit', 'pair-a')
    await service.startWalletConnect()
    const signer = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf'
    const typed = {
      domain: {
        name: 'Permit2', chainId,
        verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        PermitDetails: [
          { name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' },
        ],
        PermitSingle: [
          { name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      primaryType: 'PermitSingle',
      message: {
        details: {
          token: '0x1111111111111111111111111111111111111111',
          amount: '1461501637330902918203684832716283019655932542975',
          expiration: '2000000000', nonce: '0',
        },
        spender: '0x2222222222222222222222222222222222222222', sigDeadline: '2000000000',
      },
    } as unknown as TypedDataDefinition
    client.emit('session_request', {
      id: 30, topic: 'permit', params: {
        chainId: 'eip155:1', request: { method: 'eth_signTypedData_v4', params: [signer, JSON.stringify(typed)] },
      },
    })
    expect(service.listWalletConnectPending()).toHaveLength(1)
    service.decideWalletConnect(service.listWalletConnectPending()[0].id, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.respondSessionRequest).toHaveBeenCalledOnce()
    const reply = client.respondSessionRequest.mock.calls[0] as unknown as [{ response: { result: Hex } }]
    const signature = reply[0].response.result
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/i)
    expect(await recoverTypedDataAddress({ ...typed, signature })).toBe(signer)
  })

  it('断开后立即复用配对，重新授权后交易请求进入确认队列', async () => {
    client.pairings.add('pair-a')
    client.sessions.old = session('old', 'pair-a')
    await service.startWalletConnect()
    await service.disconnectWalletConnect('old')
    expect(client.disconnectSession).toHaveBeenCalledWith(expect.objectContaining({ topic: 'old' }))
    expect(client.core.pairing.disconnect).not.toHaveBeenCalled()
    expect(service.listWalletConnectSessions()).toEqual([])

    await service.acceptWalletConnectDeepLink(uri('pair-a'))
    expect(client.core.relayer.subscribe).toHaveBeenCalledWith('pair-a')
    propose('pair-a')
    expect(service.listWalletConnectPending()).toHaveLength(1)
    service.decideWalletConnect(service.listWalletConnectPending()[0].id, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.approveSession).toHaveBeenCalledOnce()
    expect(service.listWalletConnectSessions()[0].topic).toBe('session-1')

    client.emit('session_request', {
      id: 20, topic: 'session-1', params: {
        chainId: 'eip155:56', request: { method: 'eth_sendTransaction', params: [{ to: '0xabc', value: '0x0' }] },
      },
    })
    expect(service.listWalletConnectPending()[0]).toMatchObject({
      kind: 'send', method: 'eth_sendTransaction', verification: 'UNKNOWN',
    })
    service.decideWalletConnect(service.listWalletConnectPending()[0].id, false)
    await vi.advanceTimersByTimeAsync(0)
    expect(client.respondSessionRequest).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'session-1', response: expect.objectContaining({ id: 20, error: expect.any(Object) }),
    }))
  })

  it('A 切到 B 再重试 A，A 的新提案不会被旧配对标记拒绝', async () => {
    await service.pairWalletConnect(uri('pair-a'))
    await service.pairWalletConnect(uri('pair-b'))
    await service.pairWalletConnect(uri('pair-a'))
    propose('pair-a')
    expect(service.listWalletConnectPending()).toHaveLength(1)
    expect(client.rejectSession).not.toHaveBeenCalled()
  })

  it('已有配对必须恢复订阅；订阅失败不能假装进入等待提案状态', async () => {
    client.pairings.add('pair-a')
    client.core.relayer.subscribe.mockRejectedValueOnce(new Error('subscribe failed'))
    await expect(service.pairWalletConnect(uri('pair-a'))).rejects.toThrow('subscribe failed')
    expect(service.walletConnectPairing().active).toBe(false)
    await service.pairWalletConnect(uri('pair-a'))
    propose('pair-a')
    expect(service.listWalletConnectPending()).toHaveLength(1)
  })

  it('启动时中继恢复期间到达的提案不会被标记已处理后丢失', async () => {
    client.core.relayer.connected = false
    client.core.relayer.transportOpen.mockImplementationOnce(async () => { propose('pair-a') })
    await service.startWalletConnect()
    expect(service.listWalletConnectPending()).toHaveLength(1)
  })

  it('网站暂时不回应 ping 不会被钱包删除会话', async () => {
    client.sessions.old = session('old', 'pair-a')
    await service.startWalletConnect()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(client.disconnectSession).not.toHaveBeenCalled()
    expect(service.listWalletConnectSessions()).toHaveLength(1)
  })

  it('远端删除事件不会重复回发断开或删除配对通道', async () => {
    client.pairings.add('pair-a')
    client.sessions.old = session('old', 'pair-a')
    await service.startWalletConnect()
    delete client.sessions.old
    client.emit('session_delete', { topic: 'old' })
    await service.acceptWalletConnectDeepLink(uri('pair-a'))
    propose('pair-a')
    expect(client.disconnectSession).not.toHaveBeenCalled()
    expect(client.core.pairing.disconnect).not.toHaveBeenCalled()
    expect(service.listWalletConnectPending()).toHaveLength(1)
  })
})
