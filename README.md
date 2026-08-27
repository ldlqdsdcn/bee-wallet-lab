# Bee Wallet Lab

Electron 桌面端 Web3 钱包实验项目。助记词与私钥只存在于主进程，渲染进程通过白名单 IPC 访问。

对照实现：移动端 `onewallet-app`。第一版网络 / 代币列表打包在 `data/catalog/`，启动时写入本地 SQLite，不请求后台。链上请求由钱包进程直连 Infura / Blockstream / TronGrid / Solana RPC，密钥写在本地 `.env`。

## 功能

1. **安全基座**：scrypt KDF + AES-256-GCM，主密码锁屏，空闲自动锁定
2. **派生内核**：BIP-39/32；BTC 四种地址格式、EVM、TRON、Solana（SLIP-0010 Ed25519）
3. **内置目录**：Bitcoin / Ethereum / Arbitrum / TRON / BSC / Solana 写入本地库
4. **钱包管理**：创建（抄写校验）/ 导入助记词 / 导出 / 多钱包 / 多账户派生 / 私钥导入
5. **资产总览**：本机直连 RPC 取余额；BTC 原生币按四种地址格式展开
6. **收款转账**：BTC（Esplora）、EVM（JSON-RPC）、TRON（TronGrid）、Solana（JSON-RPC）；本地签名后直连广播
7. **交易记录**：侧栏按当前网络同步当前钱包的转入转出；BTC 走 Esplora，EVM 优先 Blockscout 其次 Etherscan，TRON 走 TronGrid，Solana 走 RPC
8. **消息签名**：EVM/TRON 为 EIP-191 `personal_sign`；Bitcoin 为 BIP-137；Solana 为 Ed25519
9. **地址簿**：本地 SQLite，转账页可选择收款人
10. **节点 / 网络 / 代币 / 水龙头 / 代理维护**：侧栏可增删改；测试网可维护多个水龙头并在应用内打开；重新装入内置目录时自定义项会保留

## 开发

```bash
npm install
npm test
npm run typecheck
npm run dev
```

```bash
cp .env.example .env
```

在 `.env` 填写 `VITE_INFURA_API_KEY`（EVM）。可选 TronGrid key、Bitcoin Esplora 地址、`VITE_ETHERSCAN_API_KEY`（EVM 交易记录；不填则走 Blockscout 公开接口）。设置页可填目录站地址；添加网络时会请求 `GET /api/network/lookup` 拿主币和热门代币，没填或失败则用本地预设。

## 数据位置

SQLite 文件在 Electron `userData` 目录下的 `bee-wallet.db`。助记词、passphrase、导入私钥均为 AES-256-GCM 密文。忘记主密码只能用助记词重新导入。

## 安全约束

- 渲染进程 `contextIsolation: true`，`nodeIntegration: false`
- preload 只暴露 `shared/ipc.ts` 白名单通道
- 导出助记词 / 揭示私钥需要再次输入主密码
- 锁定后内存 KEK 清零
- Infura / TronGrid 密钥只存在本机 `.env`，不进 git
