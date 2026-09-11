# Bee Wallet Lab

本地优先的多链实验钱包。助记词和私钥只留在本机，交易在本机签名。  
A local-first multi-chain lab wallet. Keys never leave your machine.

[中文](#中文) · [English](#english)

仓库 / Repo：https://github.com/ldlqdsdcn/bee-wallet-lab  
发布 / Releases：https://github.com/ldlqdsdcn/bee-wallet-lab/releases

---

## 中文

Electron 桌面端。密钥只存在于主进程，渲染进程通过白名单 IPC 访问。第一版网络 / 代币目录打包在 `data/catalog/`，启动时写入本地 SQLite。链上请求由钱包进程直连节点，Infura 等密钥写在本机 `.env`。

完整宣传用功能说明见 [docs/Bee_Wallet_Lab_门户功能清单.md](docs/Bee_Wallet_Lab_门户功能清单.md)。发币步骤见 [docs/发币说明.md](docs/发币说明.md)。

### 支持的链

| 链 | 能做什么 |
| --- | --- |
| **Bitcoin** | HD 派生；Legacy / Nested SegWit / Native SegWit / Taproot；转账；BIP-137 消息签名 |
| **EVM** | 常见主网与 L2；ERC-20 转账；固定总量发币；合约读写；交易实验室；批量转账 |
| **TRON** | HD 派生；TRX / TRC-20；合约读写 |
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
| 收款转账 | 地址 / 二维码收款；本机签名后广播；费率分档 |
| 交易记录 | 按当前钱包 + 当前网络同步转入转出 |
| 交易实验室 | 构造、解码、只签名、再单独广播 |
| ABI 工具 | 导入 ABI；编码 calldata；解码调用、返回值、Event |
| 合约交互 | EVM / TRON 读 view、写合约；可只签名再广播 |
| 开发工具 | JSON 格式化；Hex ↔ UTF-8 / Base64；SHA-256、Keccak-256 等哈希 |
| 发行代币 | EVM 固定总量 ERC-20；Solana 固定总量 SPL + Metaplex |
| 批量转账 | EVM 上按分层地址批量打 ERC-20；失败可重试 |
| 消息签名 | EVM/TRON `personal_sign`；Bitcoin BIP-137；Solana Ed25519 |
| 地址簿 | 本机保存公开地址，转账时选用 |
| 三方连接 | 应用内浏览器打开精选 DApp / 水龙头（第三方站点，请自行核对网址） |
| 网络 / 节点 / 代币 / 水龙头 / 代理 | 维护目录、RPC 测速、测试网领水、http/socks5 代理 |
| 中英界面 | 简体中文 / English 即时切换，菜单一起更新 |

未上线、请勿宣传为已支持：Swap、跨链桥、TRON 能量租赁、工作区导入导出、应用内自动更新。

### 开发

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npm run dev
```

在 `.env` 填写 `VITE_INFURA_API_KEY`（EVM）。可选 TronGrid key、Bitcoin Esplora、`VITE_ETHERSCAN_API_KEY`（EVM 交易记录；不填则走 Blockscout）。设置页可填目录站地址；添加网络时会请求 `GET /api/network/lookup`，没填或失败则用本地预设。改主进程或 `VITE_` 环境变量后需要重启 `npm run dev`。

### 数据位置

SQLite 在 Electron `userData` 下的 `bee-wallet.db`。助记词、passphrase、导入私钥均为 AES-256-GCM 密文。忘记主密码只能用助记词重新导入。

### 安全约束

- 渲染进程 `contextIsolation: true`，`nodeIntegration: false`
- preload 只暴露 `shared/ipc.ts` 白名单通道
- 导出助记词 / 揭示私钥需要再次输入主密码
- 锁定后内存 KEK 清零
- Infura / TronGrid 密钥只存在本机 `.env`，不进 git

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

A desktop Electron Web3 lab wallet. Mnemonics and private keys stay in the main process; the renderer talks over a whitelisted IPC. The first catalog of networks and tokens ships in `data/catalog/` and is loaded into local SQLite. Chain calls go from the wallet process to your RPCs. API keys live in a local `.env`.

The marketing feature brief is [docs/Bee_Wallet_Lab_门户功能清单.md](docs/Bee_Wallet_Lab_门户功能清单.md) (Chinese). Token-issue steps: [docs/发币说明.md](docs/发币说明.md).

### Supported chains

| Chain | What you can do |
| --- | --- |
| **Bitcoin** | HD derive; Legacy / Nested SegWit / Native SegWit / Taproot; transfer; BIP-137 signmessage |
| **EVM** | Common L1/L2s; ERC-20 transfers; fixed-supply issue; contract read/write; Transaction Lab; batch transfer |
| **TRON** | HD derive; TRX / TRC-20; contract read/write |
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
| Receive & send | Address / QR; sign locally then broadcast; fee presets |
| Activity | Sync ins/outs for the current wallet on the current network |
| Transaction Lab | Build, decode, sign only, then broadcast separately |
| ABI tools | Import ABI; encode calldata; decode calls, return values, and events |
| Contracts | EVM / TRON view reads and writes; sign-only then broadcast |
| Developer tools | JSON format/minify; Hex ↔ UTF-8 / Base64; SHA-256, Keccak-256, and more |
| Issue token | Fixed-supply ERC-20 on EVM; fixed-supply SPL + Metaplex on Solana |
| Batch transfer | Send ERC-20 to HD addresses on EVM; retry failed rows |
| Sign message | EVM/TRON `personal_sign`; Bitcoin BIP-137; Solana Ed25519 |
| Address book | Local public addresses for the send form |
| DApps | In-app browser for a curated list (third-party sites — verify the URL) |
| Networks / RPC / tokens / faucets / proxy | Catalog, latency checks, testnet faucets, http/socks5 proxy |
| Language | Instant Simplified Chinese / English, including the native menu |

Not shipped — do not advertise as available: Swap, cross-chain bridge, TRON energy rental, workspace import/export, in-app auto-update.

### Development

```bash
npm install
cp .env.example .env
npm test
npm run typecheck
npm run dev
```

Set `VITE_INFURA_API_KEY` in `.env` for EVM. Optional: TronGrid key, Bitcoin Esplora URL, `VITE_ETHERSCAN_API_KEY` (EVM history; Blockscout is used if empty). Settings can hold a catalog URL; adding a network calls `GET /api/network/lookup` and falls back to local presets. Restart `npm run dev` after main-process or `VITE_` env changes.

### Data location

SQLite lives at `bee-wallet.db` under Electron `userData`. Mnemonics, passphrases, and imported keys are AES-256-GCM ciphertext. If you forget the master password, re-import from the mnemonic.

### Security

- Renderer: `contextIsolation: true`, `nodeIntegration: false`
- Preload exposes only channels listed in `shared/ipc.ts`
- Exporting a mnemonic or revealing a key requires the master password again
- The in-memory KEK is wiped on lock
- Infura / TronGrid keys stay in local `.env` and are not committed

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
