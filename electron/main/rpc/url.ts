/** 校验并规范化用户填写的节点地址。 */
export function normalizeRpcUrl(raw: string): string {
  const trimmed = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('RPC 地址无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 节点')
  }
  return trimmed.replace(/\/+$/, '')
}

export function joinRpcPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
