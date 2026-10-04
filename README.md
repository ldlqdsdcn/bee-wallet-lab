# Bee Wallet Lab

本地优先的多链实验钱包。助记词和私钥只留在本机，交易在本机签名。  
A local-first multi-chain lab wallet. Keys never leave your machine.

[中文](#中文) · [English](#english)

仓库 / Repo：https://github.com/ldlqdsdcn/bee-wallet-lab  
发布 / Releases：https://github.com/ldlqdsdcn/bee-wallet-lab/releases

---

## 中文

Electron 桌面端。密钥只存在于主进程，渲染进程通过白名单 IPC 访问。第一版网络 / 代币目录打包在 `data/catalog/`，启动时写入本地 SQLite。链上请求由钱包进程直连节点，Infura 等密钥保存在本机工作区配置中。

完整功能说明见 [docs/功能清单.md](docs/功能清单.md)。发币步骤见 [docs/发币说明.md](docs/发币说明.md)。

### 支持的链

| 链 | 能做什么 |
| --- | --- |
| **Bitcoin** | HD 派生；Legacy / Nested SegWit / Native SegWit / Taproot；转账；跨链桥；BIP-137 消息签名 |
| **EVM** | 常见主网与 L2；ERC-20 转账；ETH / BSC / Arbitrum 同网络兑换；跨链桥；固定总量发币；合约读写；交易实验室；批量转账 |
| **TRON** | HD 派生；TRX / TRC-20；主网兑换；跨链桥；能量不足时可租能量或烧 TRX；合约读写 |
| **Solana** | HD 派生；SOL / SPL；固定总量 SPL；消息签名 |

内置包括 Ethereum、BSC、Base、Optimism、Polygon、Arbitrum、Linea、Scroll、zkSync Era、Blast、Mantle、Avalanche、Xone 以及对应测试网。也可自己加网络。Sui 等未接入链目前不能用。

### 功能

| 功能 | 说明 |
| --- | --- |
| 主密码与锁定 | scrypt + AES-256-GCM 加密本机密钥；空闲自动锁定；立即锁定；连续失败递增延迟 |
| 创建 / 导入钱包 | BIP-39（12–24 词），可选 Passphrase；导入助记词或私钥；多钱包切换 |
| 账户派生 | 按当前网络派生账户；导出助记词 / 查看私钥需再输主密码 |
| 分层钱包 | 批量生成最多 2 万条地址；私钥加密；可导出 CSV |
| 资产总览 | 直连 RPC 取余额；法币计价；节点不可达时用本地缓存 |
| 收款转账 | 地址 / 二维码收款；本机签名后广播；费率分档；TRC-20 能量不足时可租能量或烧 TRX |
| 兑换 | 同网络换币：ETH / BSC / Arbitrum（0x）、波场主网（SunSwap）；必要时授权或租能量 |
| 跨链桥 | 比特币、ETH / BSC / Arbitrum 与波场互跨；含 BTC 走 SwapKit，其余走 0x；源链本机签名 |
| 交易记录 | 按当前钱包 + 当前网络同步转入转出 |
| 交易实验室 | 构造、解码、只签名、再单独广播 |
| ABI 工具 | 导入 ABI；编码 calldata；解码调用、返回值、Event |
| 合约交互 | EVM / TRON 读 view、写合约；可只签名再广播 |
| 开发工具 | JSON 格式化；Hex ↔ UTF-8 / Base64；SHA-256、Keccak-256 等哈希 |
| 发行代币 | EVM 固定总量 ERC-20；Solana 固定总量 SPL + Metaplex |
| 批量转账 | EVM 上按分层地址批量打 ERC-20；失败可重试 |
| 消息签名 | EVM/TRON `personal_sign`；Bitcoin BIP-137；Solana Ed25519 |
| 地址簿 | 本机保存公开地址，转账时选用 |
| 三方连接 | 从目录站拉取 DApp 分类与站点，应用内浏览器打开（第三方站点，请自行核对网址） |
| 网络 / 节点 / 代币 / 水龙头 / 代理 | 维护目录、RPC 测速、测试网领水、http/socks5 代理 |
| 中英界面 | 简体中文 / English 即时切换，菜单一起更新 |


### 开发

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npm run dev
```

在 `.env` 填写 `VITE_INFURA_API_KEY`（EVM）。可选 TronGrid key、Bitcoin Esplora、`VITE_ETHERSCAN_API_KEY`（EVM 交易记录；不填则走 Blockscout）。设置页可填目录站地址；添加网络时会请求 `GET /api/network/lookup`，没填或失败则用本地预设。首次启动时会将这些配置保存到工作区的 `environment.json`；以后修改该文件并重启应用即可，工作区配置不会被其他电脑的 `.env` 覆盖。

### 数据位置

首次启动新版会将旧数据库（含 WAL 中已提交的数据）、钱包、全部数据库设置及 WalletConnect 会话迁入 Electron `userData/bee_wallet_workspace`，原文件保留用于恢复。本机开发版默认位置为 `~/.config/bee-wallet/bee_wallet_workspace`。当前工作区显示在窗口标题和「文件」菜单中，菜单可直接打开其文件夹。

- **新建工作区**：选择一个尚不存在的文件夹，创建独立数据库和主密码；沿用当前 API 配置，钱包和应用设置从空白开始。
- **打开工作区**：选择已有工作区文件夹，确认后自动重启并重新解锁。应用会记住上次使用的工作区。
- **导出工作区**：解锁后生成 `.beeworkspace` 单文件备份，包含数据库全部内容、`environment.json` 和 `walletconnect.json`；SQLite 使用一致性快照，可直接导出正在使用的工作区。
- **导入工作区**：在另一台电脑选择备份和新的目标文件夹，完成格式、完整性和数据库版本校验后恢复，再切换使用。现有目录不会被覆盖。

工作区内的 `bee-wallet.db` 保存钱包、网络、代理、应用设置、地址簿及交易等记录；`environment.json` 保存 RPC/API/WalletConnect 运行配置。导入后仍使用原主密码，助记词、passphrase、导入私钥保持 AES-256-GCM 密文。API 密钥和会话信息也会随备份保存，应妥善保管备份。浏览器缓存和网站登录状态按工作区隔离，但不随备份导出。遗失主密码仍需使用助记词恢复。

`userData/workspace-state.json` 只记录当前工作区的本机路径，不会导出。已选择的工作区不可用时会提示重新选择，不会自动创建空钱包替代它。

### 安全约束

- 渲染进程 `contextIsolation: true`，`nodeIntegration: false`
- preload 只暴露 `shared/ipc.ts` 白名单通道
- 导出助记词 / 揭示私钥需要再次输入主密码
- 锁定后内存 KEK 清零
- Infura / TronGrid 密钥保存在本机工作区配置中；工作区和备份不进 git

### 下载安装

从 [GitHub Releases](https://github.com/ldlqdsdcn/bee-wallet-lab/releases) 下载。

| 平台 | 说明 |
| --- | --- |
| Linux | AppImage（推荐）或 `.deb`。可选校验见 [docs/linux-signing.md](docs/linux-signing.md) |
| Windows / macOS | electron-builder 安装包 |

Linux 示例：

```bash
chmod +x bee-wallet-*-linux-x64.AppImage
./bee-wallet-*-linux-x64.AppImage
```

```bash
sudo apt install ./bee-wallet-*-linux-x64.deb
```

图形界面若提示未认证，选仍要安装即可。打 `v*` tag 会由 Actions 自动打包并上传 Release。

---

## English

A desktop Electron Web3 lab wallet. Mnemonics and private keys stay in the main process; the renderer talks over a whitelisted IPC. The first catalog of networks and tokens ships in `data/catalog/` and is loaded into local SQLite. Chain calls go from the wallet process to your RPCs. API keys live in local workspace configuration.

Feature list (Chinese): [docs/功能清单.md](docs/功能清单.md). Token-issue steps: [docs/发币说明.md](docs/发币说明.md).

### Supported chains

| Chain | What you can do |
| --- | --- |
| **Bitcoin** | HD derive; Legacy / Nested SegWit / Native SegWit / Taproot; transfer; cross-chain bridge; BIP-137 signmessage |
| **EVM** | Common L1/L2s; ERC-20 transfers; same-network swap on ETH / BSC / Arbitrum; cross-chain bridge; fixed-supply issue; contract read/write; Transaction Lab; batch transfer |
| **TRON** | HD derive; TRX / TRC-20; mainnet swap; cross-chain bridge; rent energy or burn TRX when the fee is short; contract read/write |
| **Solana** | HD derive; SOL / SPL; fixed-supply SPL; message signing |

Built-in networks include Ethereum, BSC, Base, Optimism, Polygon, Arbitrum, Linea, Scroll, zkSync Era, Blast, Mantle, Avalanche, Xone, and matching testnets. You can add custom networks. Chains that are not wired (for example Sui) are not supported yet.

### Features

| Feature | What it does |
| --- | --- |
| Master password & lock | scrypt + AES-256-GCM on disk; idle auto-lock; lock now; increasing delay after failed unlocks |
| Create / import | BIP-39 (12–24 words), optional passphrase; import mnemonic or private key; multiple wallets |
| Accounts | Derive per current network; export mnemonic / reveal key only after the master password |
| HD wallet | Batch-generate up to 20,000 addresses; keys encrypted; CSV export |
| Portfolio | Balances from RPC; fiat quote; cached totals when nodes are down |
| Receive & send | Address / QR; sign locally then broadcast; fee presets; TRC-20 can rent energy or burn TRX |
| Swap | Same-network swap on ETH / BSC / Arbitrum (0x) and TRON mainnet (SunSwap) |
| Bridge | Cross-chain among Bitcoin, ETH / BSC / Arbitrum, and TRON; SwapKit for BTC pairs, 0x otherwise |
| Activity | Sync ins/outs for the current wallet on the current network |
| Transaction Lab | Build, decode, sign only, then broadcast separately |
| ABI tools | Import ABI; encode calldata; decode calls, return values, and events |
| Contracts | EVM / TRON view reads and writes; sign-only then broadcast |
| Developer tools | JSON format/minify; Hex ↔ UTF-8 / Base64; SHA-256, Keccak-256, and more |
| Issue token | Fixed-supply ERC-20 on EVM; fixed-supply SPL + Metaplex on Solana |
| Batch transfer | Send ERC-20 to HD addresses on EVM; retry failed rows |
| Sign message | EVM/TRON `personal_sign`; Bitcoin BIP-137; Solana Ed25519 |
| Address book | Local public addresses for the send form |
| DApps | In-app browser for catalog DApps (third-party sites — verify the URL) |
| Networks / RPC / tokens / faucets / proxy | Catalog, latency checks, testnet faucets, http/socks5 proxy |
| Language | Instant Simplified Chinese / English, including the native menu |

Not shipped — do not advertise as available: in-app auto-update.

### Development

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npm run dev
```

Set `VITE_INFURA_API_KEY` in `.env` for EVM. Optional: TronGrid key, Bitcoin Esplora URL, `VITE_ETHERSCAN_API_KEY` (EVM history; Blockscout is used if empty). Settings can hold a catalog URL; adding a network calls `GET /api/network/lookup` and falls back to local presets. On first launch these values are saved into the workspace’s `environment.json`. Edit that file and restart to change runtime configuration; another computer’s `.env` cannot override an imported workspace.

### Data location

On first launch, existing data is migrated into `userData/bee_wallet_workspace`, retaining the legacy files for recovery. The title and File menu show the active workspace.

Use **File → New workspace** to create an independent vault in a new directory (with the current API configuration), **Open workspace** to switch to an existing directory, **Export workspace** to save a `.beeworkspace` backup, and **Import workspace** to restore a backup into a new directory on any computer. Switching restarts the app and requires unlocking again. Existing directories are never overwritten by import.

Each workspace contains `bee-wallet.db` (all wallets, settings, networks, proxies, contacts and transaction records), `environment.json` (runtime API/RPC configuration), and `walletconnect.json` (sessions). Exports use a consistent SQLite snapshot including committed WAL data. Imported wallets retain their original master password and AES-256-GCM encryption. Backups also contain API keys and session data; keep them private. Browser caches and website logins are isolated per workspace and excluded from exports. The machine-local selection is stored in `userData/workspace-state.json`. Missing workspaces prompt for recovery instead of silently opening an empty vault.

### Security

- Renderer: `contextIsolation: true`, `nodeIntegration: false`
- Preload exposes only channels listed in `shared/ipc.ts`
- Exporting a mnemonic or revealing a key requires the master password again
- The in-memory KEK is wiped on lock
- Infura / TronGrid keys stay in local workspace configuration; workspaces and backups are not committed

### Downloads

Get builds from [GitHub Releases](https://github.com/ldlqdsdcn/bee-wallet-lab/releases).

| Platform | Notes |
| --- | --- |
| Linux | AppImage (recommended) or `.deb`. Optional verify: [docs/linux-signing.md](docs/linux-signing.md) |
| Windows / macOS | electron-builder installers |

Linux:

```bash
chmod +x bee-wallet-*-linux-x64.AppImage
./bee-wallet-*-linux-x64.AppImage
```

```bash
sudo apt install ./bee-wallet-*-linux-x64.deb
```

If the GUI installer says the package is unauthenticated, install anyway — it came from GitHub, not the distro archive. Pushing a `v*` tag builds and uploads a Release via Actions.
