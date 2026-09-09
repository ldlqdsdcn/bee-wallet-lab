/**
 * 固定总量 SPL：创建 mint、一次铸给发行账户、写入 Metaplex 元数据、关掉增发。
 */
import { randomBytes } from 'node:crypto'
import { solanaAddressFromPrivateKey } from '../derive/solana'
import { invalidArg } from '../ipc/registry'
import { normalizeIssueFields, type NormalizedIssue } from './encode'

export const SOLANA_ISSUE_MAX_DECIMALS = 9
export const DEFAULT_SOLANA_DECIMALS = 9
export const SOLANA_U64_MAX = 2n ** 64n - 1n
export const METAPLEX_MAX_URI = 200

export interface SolanaMetadataFields {
  description: string
  logoUrl: string
  website: string
  metadataUri: string
  metadataJson: string
}

export function normalizeSolanaIssueFields(input: {
  name?: string
  symbol?: string
  decimals?: number
  supply?: string
}): NormalizedIssue {
  return normalizeIssueFields(input, {
    maxDecimals: SOLANA_ISSUE_MAX_DECIMALS,
    defaultDecimals: DEFAULT_SOLANA_DECIMALS,
    maxSupplyMinor: SOLANA_U64_MAX,
    maxNameLength: 32,
    maxSymbolLength: 10,
  })
}

function trimPublicUri(value: string | undefined, label: string, max: number): string {
  const url = (value ?? '').trim()
  if (!url) return ''
  if (!/^(https?:\/\/|ipfs:\/\/|ar:\/\/)/i.test(url)) {
    throw invalidArg(`${label}需要 http、https、ipfs:// 或 ar:// 地址`)
  }
  if (url.length > max) throw invalidArg(`${label}太长`)
  return url
}

export function buildMetaplexJson(input: {
  name: string
  symbol: string
  description?: string
  logoUrl?: string
  website?: string
}): string {
  const body: Record<string, string> = {
    name: input.name,
    symbol: input.symbol,
  }
  const description = (input.description ?? '').trim()
  if (description) body.description = description.slice(0, 200)
  if (input.logoUrl) body.image = input.logoUrl
  if (input.website) body.external_url = input.website
  return `${JSON.stringify(body, null, 2)}\n`
}

export function normalizeSolanaMetadata(input: {
  name: string
  symbol: string
  description?: string
  logoUrl?: string
  website?: string
  metadataUri?: string
}): SolanaMetadataFields {
  const description = (input.description ?? '').trim().slice(0, 200)
  const logoUrl = trimPublicUri(input.logoUrl, 'Logo', 512)
  const website = trimPublicUri(input.website, '官网', 256)
  const metadataJson = buildMetaplexJson({
    name: input.name,
    symbol: input.symbol,
    description,
    logoUrl,
    website,
  })
  const metadataUri = trimPublicUri(input.metadataUri, '元数据 URI', METAPLEX_MAX_URI)
  return { description, logoUrl, website, metadataUri, metadataJson }
}

export function createMintKeypair(): { secret: Uint8Array; address: string } {
  const secret = randomBytes(32)
  return { secret, address: solanaAddressFromPrivateKey(secret) }
}
