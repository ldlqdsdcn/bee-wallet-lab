/**
 * IPC 通道契约。
 *
 * 安全约定：
 * 1. 渲染进程只能通过本文件列出的白名单通道调用主进程；
 * 2. 返回值禁止包含助记词、私钥、KEK、JWT 原文，
 *    唯一例外是 `wallet:exportMnemonic` / `account:revealPrivateKey` /
 *    `account:hdDeriveEvm` / `account:hdKeyUnlock` / `account:hdKeyReveal`，
 *    它们必须在主进程内二次校验主密码后才返回。
 * 3. `wallet:remove` 不返回密钥，但仍须校验主密码后才能删除。
 */

export const IPC = {
  /* 保险库 / 主密码 */
  vaultStatus: 'vault:status',
  vaultInitialize: 'vault:initialize',
  vaultUnlock: 'vault:unlock',
  vaultLock: 'vault:lock',
  vaultChangePassword: 'vault:changePassword',
  vaultTouch: 'vault:touch',

  /* 设置 */
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  /* 代理 */
  proxyList: 'proxy:list',
  proxyAdd: 'proxy:add',
  proxyUpdate: 'proxy:update',
  proxyRemove: 'proxy:remove',
  proxySelect: 'proxy:select',
  proxyPing: 'proxy:ping',
  proxyPingAll: 'proxy:pingAll',
  proxySetEnabled: 'proxy:setEnabled',

  /* 钱包 */
  walletList: 'wallet:list',
  walletListPage: 'wallet:listPage',
  walletCurrent: 'wallet:current',
  walletCreateDraft: 'wallet:createDraft',
  walletConfirmDraft: 'wallet:confirmDraft',
  walletImportMnemonic: 'wallet:importMnemonic',
  walletValidateMnemonic: 'wallet:validateMnemonic',
  walletExportMnemonic: 'wallet:exportMnemonic',
  walletRename: 'wallet:rename',
  walletSetDefault: 'wallet:setDefault',
  walletSetAuthWallet: 'wallet:setAuthWallet',
  walletRemove: 'wallet:remove',

  /* 账户 */
  accountList: 'account:list',
  accountDerive: 'account:derive',
  accountImportPrivateKey: 'account:importPrivateKey',
  accountRevealPrivateKey: 'account:revealPrivateKey',
  accountRename: 'account:rename',
  accountRemove: 'account:remove',
  accountPreviewDerivation: 'account:previewDerivation',
  accountHdDeriveEvm: 'account:hdDeriveEvm',
  accountHdKeyList: 'account:hdKeyList',
  accountHdKeyUnlock: 'account:hdKeyUnlock',
  accountHdKeyReveal: 'account:hdKeyReveal',
  accountHdKeyClear: 'account:hdKeyClear',

  /* 后端接入 */
  backendStatus: 'backend:status',
  backendAuthenticate: 'backend:authenticate',
  backendPing: 'backend:ping',

  /* 目录同步 */
  catalogNetworks: 'catalog:networks',
  catalogTokens: 'catalog:tokens',
  catalogCurrencies: 'catalog:currencies',
  catalogSync: 'catalog:sync',
  catalogNetworkUpsert: 'catalog:network:upsert',
  catalogNetworkRemove: 'catalog:network:remove',
  catalogTokenUpsert: 'catalog:token:upsert',
  catalogTokenRemove: 'catalog:token:remove',
  catalogLookup: 'catalog:lookup',

  /* 资产 */
  portfolioSnapshot: 'portfolio:snapshot',
  portfolioRefresh: 'portfolio:refresh',

  /* 收发转账 */
  transferPreview: 'transfer:preview',
  transferSubmit: 'transfer:submit',
  transferReceiveInfo: 'transfer:receiveInfo',
  transactionList: 'transaction:list',
  transactionSync: 'transaction:sync',

  /* 消息签名 */
  signMessage: 'sign:message',
  verifyMessage: 'sign:verify',

  /* 地址簿 */
  addressBookList: 'addressBook:list',
  addressBookUpsert: 'addressBook:upsert',
  addressBookRemove: 'addressBook:remove',
  addressBookTouch: 'addressBook:touch',

  /* RPC 节点 */
  rpcList: 'rpc:list',
  rpcAdd: 'rpc:add',
  rpcRemove: 'rpc:remove',
  rpcSelect: 'rpc:select',
  rpcPing: 'rpc:ping',
  rpcPingAll: 'rpc:pingAll',
  rpcRestore: 'rpc:restore',

  /* 测试网水龙头 */
  faucetList: 'faucet:list',
  faucetUpsert: 'faucet:upsert',
  faucetRemove: 'faucet:remove',
  faucetRestore: 'faucet:restore',

  /* 发行 ERC-20 */
  tokenIssuePreview: 'token:issuePreview',
  tokenIssueSubmit: 'token:issueSubmit',
  tokenIssueList: 'token:issueList',

  /* 分层钱包批量转 ERC-20 */
  hdAirdropPreview: 'hdAirdrop:preview',
  hdAirdropStart: 'hdAirdrop:start',
  hdAirdropStop: 'hdAirdrop:stop',
  hdAirdropStatus: 'hdAirdrop:status',
  hdAirdropJobs: 'hdAirdrop:jobs',
  hdAirdropItems: 'hdAirdrop:items',
  hdAirdropRetry: 'hdAirdrop:retry',

  /* 交易实验室：只签名 / 解码 / 单独广播 */
  txLabSign: 'txLab:sign',
  txLabDecode: 'txLab:decode',
  txLabBroadcast: 'txLab:broadcast',

  /* ABI 工具 */
  abiParse: 'abi:parse',
  abiPreset: 'abi:preset',
  abiList: 'abi:list',
  abiUpsert: 'abi:upsert',
  abiRemove: 'abi:remove',
  abiEncode: 'abi:encode',
  abiDecodeCall: 'abi:decodeCall',
  abiDecodeResult: 'abi:decodeResult',
  abiDecodeEvent: 'abi:decodeEvent',

  /* 合约交互：读 / 写预览 / 只签名 */
  contractRead: 'contract:read',
  contractPreview: 'contract:preview',
  contractSign: 'contract:sign',

  /* 开发工具：JSON / Hex / Hash */
  devToolsJson: 'devTools:json',
  devToolsConvert: 'devTools:convert',
  devToolsHash: 'devTools:hash',

  /* 同网络兑换 */
  swapQuote: 'swap:quote',
  swapSubmit: 'swap:submit',
  swapList: 'swap:list',

  /* 跨链桥 */
  bridgeQuote: 'bridge:quote',
  bridgeSubmit: 'bridge:submit',
  bridgeStatus: 'bridge:status',
  bridgeList: 'bridge:list',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export const IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC)

/** 主进程主动推送给渲染进程的事件 */
export const IPC_EVENT = {
  vaultLocked: 'event:vaultLocked',
  vaultUnlocked: 'event:vaultUnlocked',
  catalogUpdated: 'event:catalogUpdated',
  backendStatusChanged: 'event:backendStatusChanged',
  balanceUpdated: 'event:balanceUpdated',
  addressBookUpdated: 'event:addressBookUpdated',
  walletsChanged: 'event:walletsChanged',
  rpcNodesChanged: 'event:rpcNodesChanged',
  proxiesChanged: 'event:proxiesChanged',
  faucetsChanged: 'event:faucetsChanged',
  transactionUpdated: 'event:transactionUpdated',
  hdAirdropProgress: 'event:hdAirdropProgress',
  appCommand: 'event:appCommand',
} as const

export type IpcEventName = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]

export const IPC_EVENTS: readonly IpcEventName[] = Object.values(IPC_EVENT)

/** 统一的调用结果包装，避免 Error 对象跨进程丢失信息 */
export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

/** 原生菜单发给渲染进程的命令。工作区导入导出第一版只弹说明。 */
export type AppCommand =
  | { action: 'navigate'; path: string; state?: Record<string, unknown> }
  | { action: 'lock' }
  | { action: 'workspace'; kind: 'new' | 'import' | 'export' }
  | { action: 'switchNetwork' }

