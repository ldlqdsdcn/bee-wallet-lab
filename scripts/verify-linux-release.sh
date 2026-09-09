#!/usr/bin/env bash
# 校验从 GitHub Release 下来的 Linux 包是否和仓库里的公钥、SHA256SUMS 一致。
set -euo pipefail

DIR="${1:-.}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="${REPO_ROOT}/packaging/linux/bee-wallet-lab.asc"

if [[ ! -f "${PUB}" ]]; then
  echo "仓库里还没有公钥：${PUB}" >&2
  exit 1
fi
if [[ ! -f "${DIR}/SHA256SUMS" ]]; then
  echo "${DIR}/SHA256SUMS 不存在。请和 AppImage/deb 放在同一目录。" >&2
  exit 1
fi

(
  cd "${DIR}"
  sha256sum -c SHA256SUMS
)

if [[ ! -f "${DIR}/SHA256SUMS.asc" ]]; then
  echo "没有 SHA256SUMS.asc，只做了哈希校验，无法确认是项目维护者签的。"
  exit 0
fi

HOME_DIR="$(mktemp -d)"
chmod 700 "${HOME_DIR}"
GNUPGHOME="${HOME_DIR}" gpg --batch --import "${PUB}"
GNUPGHOME="${HOME_DIR}" gpg --batch --verify "${DIR}/SHA256SUMS.asc" "${DIR}/SHA256SUMS"
rm -rf "${HOME_DIR}"
echo "GPG 签名有效。"
