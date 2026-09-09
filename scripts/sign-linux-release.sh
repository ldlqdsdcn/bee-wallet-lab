#!/usr/bin/env bash
# 给 electron-builder 打出的 Linux 包生成 SHA256SUMS，并尽量用本机或环境变量里的 GPG 签名。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STORE="${HOME}/.config/bee-wallet-lab/linux-gpg"
VERSION="$(node -p "require('${REPO_ROOT}/package.json').version")"
OUT="${1:-${REPO_ROOT}/release/${VERSION}}"

if [[ ! -d "${OUT}" ]]; then
  echo "找不到打包目录：${OUT}" >&2
  echo "请先运行 npm run build:linux" >&2
  exit 1
fi

cd "${OUT}"
mapfile -t FILES < <(find . -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.deb' \) | sed 's|^\./||' | sort)
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "目录里没有 AppImage / deb：${OUT}" >&2
  exit 1
fi

rm -f SHA256SUMS SHA256SUMS.asc
sha256sum -- "${FILES[@]}" > SHA256SUMS

import_and_sign() {
  local keyfile="$1"
  local passfile="$2"
  local home
  home="$(mktemp -d)"
  chmod 700 "${home}"
  GNUPGHOME="${home}" gpg --batch --import "${keyfile}"
  GNUPGHOME="${home}" gpg --batch --yes --pinentry-mode loopback \
    --passphrase-file "${passfile}" --detach-sign --armor -o SHA256SUMS.asc SHA256SUMS
  rm -rf "${home}"
}

if [[ -n "${LINUX_GPG_PRIVATE_KEY:-}" && -n "${LINUX_GPG_PASSPHRASE:-}" ]]; then
  KEY="$(mktemp)"
  PASS="$(mktemp)"
  printf '%s\n' "${LINUX_GPG_PRIVATE_KEY}" > "${KEY}"
  printf '%s\n' "${LINUX_GPG_PASSPHRASE}" > "${PASS}"
  chmod 600 "${KEY}" "${PASS}"
  import_and_sign "${KEY}" "${PASS}"
  rm -f "${KEY}" "${PASS}"
  echo "已签名 ${OUT}/SHA256SUMS.asc"
elif [[ -f "${STORE}/private.asc" && -f "${STORE}/passphrase" ]]; then
  import_and_sign "${STORE}/private.asc" "${STORE}/passphrase"
  echo "已用本机密钥签名 ${OUT}/SHA256SUMS.asc"
else
  echo "没有 GPG 私钥，只写入了 ${OUT}/SHA256SUMS（未签名）。"
  echo "本机生成密钥：bash scripts/create-linux-signing-key.sh"
fi
