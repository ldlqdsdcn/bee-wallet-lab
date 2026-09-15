/** 分层地址导出与序号范围：逗号分隔，不含私钥。 */

export function parseHdIndexRange(fromRaw: string, toRaw: string): { fromIndex: number; toIndex: number } | null {
  const fromIndex = Number(fromRaw)
  const toIndex = Number(toRaw)
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < fromIndex) {
    return null
  }
  return { fromIndex, toIndex }
}

export function hdAddressListText(addresses: string[]): string {
  return addresses.map((item) => item.trim()).filter(Boolean).join(',')
}

export function hdExportFilename(walletName: string, suffix: string): string {
  const safe = walletName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'hd'
  return `${safe}-${suffix}`
}

export function downloadTextFile(filename: string, body: string, mime: string): void {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
