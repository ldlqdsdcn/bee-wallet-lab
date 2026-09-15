/** 批量转账收款地址：逗号分隔，也接受中文逗号、分号和换行。 */

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

export function parseRecipientTokens(text: string): string[] {
  return text
    .split(/[,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function collectRecipientAddresses(text: string): {
  addresses: string[]
  invalid: string[]
  duplicateCount: number
} {
  const seen = new Set<string>()
  const addresses: string[] = []
  const invalid: string[] = []
  let duplicateCount = 0
  for (const token of parseRecipientTokens(text)) {
    if (!EVM_ADDRESS.test(token)) {
      invalid.push(token)
      continue
    }
    const key = token.toLowerCase()
    if (seen.has(key)) {
      duplicateCount += 1
      continue
    }
    seen.add(key)
    addresses.push(token)
  }
  return { addresses, invalid, duplicateCount }
}

export function mergeRecipientText(current: string, incoming: string): string {
  const existing = parseRecipientTokens(current)
  const seen = new Set(existing.map((item) => item.toLowerCase()))
  const extra = parseRecipientTokens(incoming).filter((item) => {
    const key = item.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...existing, ...extra].join(',')
}
