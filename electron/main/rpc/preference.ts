/** 运行期记住每个网络当前打通的 RPC，切节点或失败时清掉。 */
const preferred = new Map<string, string>()

export function getPreferredRpc(networkPk: string): string | null {
  return preferred.get(networkPk) ?? null
}

export function setPreferredRpc(networkPk: string, url: string | null): void {
  if (!url) preferred.delete(networkPk)
  else preferred.set(networkPk, url)
}
