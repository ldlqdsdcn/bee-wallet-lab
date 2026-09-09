# Linux 发布校验（Ubuntu / Debian）

别人从 GitHub 下载 AppImage 或 `.deb` **就可以用**，不需要先装任何证书。

Ubuntu 没有 Windows 那种「商店代签、全世界自动信任」的免费证书。我们做的是：

1. Release 里放安装包
2. 放 `SHA256SUMS`（文件哈希）
3. 用项目 GPG 私钥签 `SHA256SUMS`（证明是维护者打的包）
4. 公钥放在仓库 `packaging/linux/bee-wallet-lab.asc`，任何人都能核对（指纹 `9F061B1D9416790EF5B68AA1ABBE5D7EB16BE83F`）

没导入公钥也能装；导入只是为了确认包没被掉包。

## 用户：下载后怎么用

到 [Releases](https://github.com/ldlqdsdcn/bee-wallet-lab/releases) 下载对应版本。

**AppImage（推荐，双击即用）**

```bash
chmod +x bee-wallet-*-linux-x64.AppImage
./bee-wallet-*-linux-x64.AppImage
```

**deb（Ubuntu / Debian）**

```bash
sudo apt install ./bee-wallet-*-linux-x64.deb
```

图形安装器若提示「软件包未认证」，选仍要安装即可。这是因为包来自 GitHub，不是 Ubuntu 官方源，不是包坏了。

**可选：核对哈希和签名**

把 `SHA256SUMS`、`SHA256SUMS.asc` 和安装包放在同一目录，在仓库根目录执行：

```bash
bash scripts/verify-linux-release.sh /path/to/下载目录
```

## 维护者：本机密钥（只做一次）

```bash
bash scripts/create-linux-signing-key.sh
```

私钥和口令只写在本机：

- `~/.config/bee-wallet-lab/linux-gpg/private.asc`
- `~/.config/bee-wallet-lab/linux-gpg/passphrase`

不要把这两份提交到 git，也不要发到聊天里。

本地打包并签名：

```bash
npm run build:linux
bash scripts/sign-linux-release.sh
```

## 维护者：让 GitHub Actions 自动签

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| 名称 | 内容 |
| --- | --- |
| `LINUX_GPG_PRIVATE_KEY` | `private.asc` 全文（含 `BEGIN PGP PRIVATE KEY`） |
| `LINUX_GPG_PASSPHRASE` | `passphrase` 文件里的那一行 |

打 tag 后会自动出 Release：

```bash
git tag v0.1.0
git push origin v0.1.0
```

`package.json` 的 `version` 应和 tag 一致（例如 `0.1.0`）。没配上述 Secret 时，Release 仍会带安装包和 `SHA256SUMS`，只是没有 `.asc` 签名。
