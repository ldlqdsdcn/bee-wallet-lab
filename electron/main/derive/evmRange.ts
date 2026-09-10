/**
 * EVM 批量派生，复用通用 HD range。
 */
import { deriveHdRange, normalizeHdRange, HD_RANGE_MAX, type HdRangeRow } from './hdRange'

export const EVM_RANGE_MAX = HD_RANGE_MAX
export const normalizeEvmRange = normalizeHdRange

export interface EvmRangeInput {
  seed: Uint8Array
  accountIndex?: number
  fromIndex: number
  toIndex: number
  skipIndexes?: Iterable<number>
}

export type EvmRangeRow = HdRangeRow

export function deriveEvmRange(input: EvmRangeInput): EvmRangeRow[] {
  return deriveHdRange({
    seed: input.seed,
    walletType: 'web3',
    networkScope: 'mainnet',
    accountIndex: input.accountIndex,
    fromIndex: input.fromIndex,
    toIndex: input.toIndex,
    skipIndexes: input.skipIndexes,
  })
}
