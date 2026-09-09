#!/usr/bin/env bash
# 生成本项目 Linux 发布用的 GPG 密钥。私钥不进 git。
set -euo pipefail

NAME="Bee Wallet Lab"
EMAIL="ldlqdsdcn@gmail.com"
STORE="${HOME}/.config/bee-wallet-lab/linux-gpg"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB_OUT="${REPO_ROOT}/packaging/linux/bee-wallet-lab.asc"

mkdir -p "${STORE}"
chmod 700 "${STORE}"
mkdir -p "$(dirname "${PUB_OUT}")"

if [[ -f "${STORE}/private.asc" && -f "${STORE}/passphrase" ]]; then
  echo "已有本机密钥：${STORE}/private.asc"
else
  PASSPHRASE="$(openssl rand -base64 32)"
  printf '%s\n' "${PASSPHRASE}" > "${STORE}/passphrase"
  chmod 600 "${STORE}/passphrase"

  TMPHOME="$(mktemp -d)"
  chmod 700 "${TMPHOME}"
  export GNUPGHOME="${TMPHOME}"

  cat > "${TMPHOME}/gen" <<EOF
%echo 生成 Bee Wallet Lab 发布密钥
Key-Type: EDDSA
Key-Curve: ed25519
Subkey-Type: ECDH
Subkey-Curve: cv25519
Name-Real: ${NAME}
Name-Email: ${EMAIL}
Expire-Date: 3y
Passphrase: ${PASSPHRASE}
%commit
%echo 完成
EOF

  gpg --batch --generate-key "${TMPHOME}/gen"
  FPR="$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr:/ { print $10; exit }')"
  printf '%s\n' "${FPR}" > "${STORE}/fingerprint"
  gpg --batch --pinentry-mode loopback --passphrase-file "${STORE}/passphrase" \
    --armor --export-secret-keys "${FPR}" > "${STORE}/private.asc"
  chmod 600 "${STORE}/private.asc"
  gpg --armor --export "${FPR}" > "${STORE}/public.asc"
  unset GNUPGHOME
  rm -rf "${TMPHOME}"
  echo "已生成指纹 ${FPR}"
fi

cp "${STORE}/public.asc" "${PUB_OUT}"
echo "公钥已写入 ${PUB_OUT}"
echo "私钥只在本机：${STORE}/private.asc"
echo "口令只在本机：${STORE}/passphrase"
echo
echo "请到 GitHub 仓库 Settings → Secrets and variables → Actions 添加："
echo "  LINUX_GPG_PRIVATE_KEY  =  ${STORE}/private.asc  的全文"
echo "  LINUX_GPG_PASSPHRASE   =  ${STORE}/passphrase  的全文"
