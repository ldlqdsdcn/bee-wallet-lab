/**
 * 把第三方交易索引响应当成 HistoryTxDraft。纯函数，便于单测。
 */
import { asNumber, asRecord, asString, extractList } from '../backend/list'
import { tronAddressFromEvmAddress } from '../derive/tron'
import { type HistoryTxDraft, sameAddress } from './types'

function asBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && value.trim()) {
    try {
      if (value.startsWith('0x') || value.startsWith('0X')) return BigInt(value)
      if (/^\d+$/.test(value.trim())) return BigInt(value.trim())
    } catch {
      return fallback
    }
  }
  return fallback
}

function statusFromFlag(ok: boolean, pending: boolean): HistoryTxDraft['status'] {
  if (pending) return 'pending'
  return ok ? 'confirmed' : 'failed'
}

export function parseEsploraAddressTxs(payload: unknown, address: string, symbol = 'BTC'): HistoryTxDraft[] {
  const rows = extractList<unknown>(payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.txid)
    if (!txid) continue
    const status = asRecord(tx.status) ?? {}
    const confirmed = Boolean(status.confirmed)
    let received = 0n
    let sent = 0n
    let from = ''
    let to = ''
    for (const vin of extractList<unknown>(tx.vin)) {
      const item = asRecord(vin)
      const prev = asRecord(item?.prevout) ?? {}
      const addr = asString(prev.scriptpubkey_address)
      const value = asBigInt(prev.value)
      if (!addr) continue
      if (!from) from = addr
      if (sameAddress(addr, address)) sent += value
    }
    for (const vout of extractList<unknown>(tx.vout)) {
      const item = asRecord(vout)
      if (!item) continue
      const addr = asString(item.scriptpubkey_address)
      const value = asBigInt(item.value)
      if (!addr) continue
      if (!to && !sameAddress(addr, address)) to = addr
      if (sameAddress(addr, address)) received += value
    }
    const fee = asBigInt(tx.fee)
    const net = received - sent
    const direction: HistoryTxDraft['direction'] = net >= 0n ? 'receive' : 'send'
    const outflow = sent - received
    const amount = direction === 'receive' ? net : outflow > fee ? outflow - fee : outflow
    if (amount === 0n && sent === 0n && received === 0n) continue
    out.push({
      txid,
      direction,
      fromAddress: from || (direction === 'send' ? address : to),
      toAddress: to || (direction === 'receive' ? address : from),
      amountMinor: amount,
      decimals: 8,
      symbol,
      contractAddress: null,
      feeMinor: fee,
      status: statusFromFlag(true, !confirmed),
      blockHeight: typeof status.block_height === 'number' ? status.block_height : null,
      timestampMs: asNumber(status.block_time, 0) * 1000 || Date.now(),
    })
  }
  return out
}

export function parseEtherscanTxlist(
  payload: unknown,
  address: string,
  symbol: string,
  decimals: number,
): HistoryTxDraft[] {
  const root = asRecord(payload)
  const rows = extractList<unknown>(root?.result ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.hash)
    const from = asString(tx.from)
    const to = asString(tx.to)
    if (!txid || !from) continue
    const value = asBigInt(tx.value)
    if (value === 0n) continue
    const failed = asString(tx.isError) === '1' || asString(tx.txreceipt_status) === '0'
    const gasUsed = asBigInt(tx.gasUsed)
    const gasPrice = asBigInt(tx.gasPrice)
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to || '',
      amountMinor: value,
      decimals,
      symbol,
      contractAddress: null,
      feeMinor: gasUsed * gasPrice,
      status: statusFromFlag(!failed, false),
      blockHeight: asNumber(tx.blockNumber, 0) || null,
      timestampMs: asNumber(tx.timeStamp, 0) * 1000 || Date.now(),
    })
  }
  return out
}

export function parseEtherscanTokentx(payload: unknown, address: string): HistoryTxDraft[] {
  const root = asRecord(payload)
  const rows = extractList<unknown>(root?.result ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.hash)
    const from = asString(tx.from)
    const to = asString(tx.to)
    const symbol = asString(tx.tokenSymbol).toUpperCase()
    if (!txid || !from || !symbol) continue
    const decimals = asNumber(tx.tokenDecimal, 18)
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to,
      amountMinor: asBigInt(tx.value),
      decimals,
      symbol,
      contractAddress: asString(tx.contractAddress) || null,
      feeMinor: null,
      status: 'confirmed',
      blockHeight: asNumber(tx.blockNumber, 0) || null,
      timestampMs: asNumber(tx.timeStamp, 0) * 1000 || Date.now(),
    })
  }
  return out
}

export function parseBlockscoutTransactions(
  payload: unknown,
  address: string,
  symbol: string,
  decimals: number,
): HistoryTxDraft[] {
  const rows = extractList<unknown>(asRecord(payload)?.items ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.hash)
    const from = asString(asRecord(tx.from)?.hash, asString(tx.from))
    const to = asString(asRecord(tx.to)?.hash, asString(tx.to))
    if (!txid || !from) continue
    const value = asBigInt(tx.value)
    if (value === 0n) continue
    const ok = asString(tx.status, 'ok') !== 'error'
    const fee = asRecord(tx.fee)
    const time = asString(tx.timestamp)
    const ts = time ? Date.parse(time) : Date.now()
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to,
      amountMinor: value,
      decimals,
      symbol,
      contractAddress: null,
      feeMinor: fee ? asBigInt(fee.value) : null,
      status: statusFromFlag(ok, asString(tx.result) === 'pending'),
      blockHeight: asNumber(tx.block_number ?? tx.block, 0) || null,
      timestampMs: Number.isFinite(ts) ? ts : Date.now(),
    })
  }
  return out
}

export function parseBlockscoutTokenTransfers(payload: unknown, address: string): HistoryTxDraft[] {
  const rows = extractList<unknown>(asRecord(payload)?.items ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.transaction_hash, asString(tx.tx_hash))
    const from = asString(asRecord(tx.from)?.hash, asString(tx.from))
    const to = asString(asRecord(tx.to)?.hash, asString(tx.to))
    const token = asRecord(tx.token) ?? {}
    const total = asRecord(tx.total) ?? {}
    const symbol = asString(token.symbol, asString(tx.token_symbol)).toUpperCase()
    if (!txid || !from || !symbol) continue
    const time = asString(tx.timestamp)
    const ts = time ? Date.parse(time) : Date.now()
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to,
      amountMinor: asBigInt(total.value ?? tx.amount),
      decimals: asNumber(token.decimals ?? total.decimals, 18),
      symbol,
      contractAddress: asString(token.address, asString(tx.token_address)) || null,
      feeMinor: null,
      status: 'confirmed',
      blockHeight: asNumber(tx.block_number, 0) || null,
      timestampMs: Number.isFinite(ts) ? ts : Date.now(),
    })
  }
  return out
}

function visibleTronAddress(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value.startsWith('T')) return value
  const hex = value.replace(/^0x/i, '')
  if (/^41[0-9a-fA-F]{40}$/.test(hex)) {
    try {
      return tronAddressFromEvmAddress(`0x${hex.slice(2)}`)
    } catch {
      return value
    }
  }
  if (/^[0-9a-fA-F]{40}$/.test(hex)) {
    try {
      return tronAddressFromEvmAddress(`0x${hex}`)
    } catch {
      return value
    }
  }
  return value
}

export function parseTronGridTransactions(payload: unknown, address: string, symbol = 'TRX'): HistoryTxDraft[] {
  const rows = extractList<unknown>(asRecord(payload)?.data ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.txID, asString(tx.transaction_id))
    const raw = asRecord(tx.raw_data) ?? {}
    const contracts = extractList<unknown>(raw.contract)
    const first = asRecord(contracts[0])
    const value = asRecord(asRecord(first?.parameter)?.value) ?? {}
    const type = asString(first?.type)
    if (!txid || type !== 'TransferContract') continue
    const from = visibleTronAddress(asString(value.owner_address))
    const to = visibleTronAddress(asString(value.to_address))
    const ret = asRecord(extractList<unknown>(tx.ret)[0])
    const ok = !ret || asString(ret.contractRet, 'SUCCESS') === 'SUCCESS'
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to,
      amountMinor: asBigInt(value.amount),
      decimals: 6,
      symbol,
      contractAddress: null,
      feeMinor: null,
      status: statusFromFlag(ok, false),
      blockHeight: asNumber(tx.blockNumber, 0) || null,
      timestampMs: asNumber(raw.timestamp, asNumber(tx.block_timestamp, Date.now())),
    })
  }
  return out
}

function tronInternalCallValue(data: Record<string, unknown> | null): bigint {
  if (!data) return 0n
  const call = data.call_value
  if (call && typeof call === 'object') {
    const record = asRecord(call)
    return asBigInt(record?._ ?? record?.amount)
  }
  return asBigInt(call ?? data.value)
}

/** 合约内部转出的 TRX（兑换打回主币）。跳过被拒的内部调用。 */
export function parseTronGridInternal(payload: unknown, address: string, symbol = 'TRX'): HistoryTxDraft[] {
  const rows = extractList<unknown>(asRecord(payload)?.data ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const data = asRecord(tx.data)
    if (data?.rejected === true) continue
    const txid = asString(tx.tx_id, asString(tx.transaction_id))
    const from = visibleTronAddress(asString(tx.from_address))
    const to = visibleTronAddress(asString(tx.to_address))
    const amountMinor = tronInternalCallValue(data)
    if (!txid || amountMinor <= 0n || (!sameAddress(from, address) && !sameAddress(to, address))) continue
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to,
      amountMinor,
      decimals: 6,
      symbol,
      contractAddress: null,
      feeMinor: null,
      status: 'confirmed',
      blockHeight: asNumber(tx.block_number, 0) || null,
      timestampMs: asNumber(tx.block_timestamp, Date.now()),
    })
  }
  return out
}

export function parseTronGridTrc20(payload: unknown, address: string): HistoryTxDraft[] {
  const rows = extractList<unknown>(asRecord(payload)?.data ?? payload)
  const out: HistoryTxDraft[] = []
  for (const row of rows) {
    const tx = asRecord(row)
    if (!tx) continue
    const txid = asString(tx.transaction_id)
    const from = visibleTronAddress(asString(tx.from))
    const to = visibleTronAddress(asString(tx.to))
    const info = asRecord(tx.token_info) ?? {}
    const symbol = asString(info.symbol, asString(tx.token_abbr)).toUpperCase()
    if (!txid || !from || !symbol) continue
    out.push({
      txid,
      direction: sameAddress(from, address) ? 'send' : 'receive',
      fromAddress: from,
      toAddress: to,
      amountMinor: asBigInt(tx.value),
      decimals: asNumber(info.decimals, 6),
      symbol,
      contractAddress: asString(info.address, asString(tx.token_address)) || null,
      feeMinor: null,
      status: 'confirmed',
      blockHeight: null,
      timestampMs: asNumber(tx.block_timestamp, Date.now()),
    })
  }
  return out
}

export function parseSolanaSignatures(payload: unknown): { signature: string; slot: number; err: boolean; blockTime: number | null }[] {
  const rows = extractList<unknown>(payload)
  const out: { signature: string; slot: number; err: boolean; blockTime: number | null }[] = []
  for (const row of rows) {
    const item = asRecord(row)
    if (!item) continue
    const signature = asString(item.signature)
    if (!signature) continue
    out.push({
      signature,
      slot: asNumber(item.slot, 0),
      err: item.err != null,
      blockTime: typeof item.blockTime === 'number' ? item.blockTime : null,
    })
  }
  return out
}

export function parseSolanaTransaction(
  payload: unknown,
  address: string,
  signature: string,
  meta: { slot: number; err: boolean; blockTime: number | null },
): HistoryTxDraft[] {
  const root = asRecord(payload)
  if (!root) {
    return [
      {
        txid: signature,
        direction: 'send',
        fromAddress: address,
        toAddress: '',
        amountMinor: 0n,
        decimals: 9,
        symbol: 'SOL',
        contractAddress: null,
        feeMinor: null,
        status: meta.err ? 'failed' : 'confirmed',
        blockHeight: meta.slot || null,
        timestampMs: (meta.blockTime ?? 0) * 1000 || Date.now(),
      },
    ]
  }
  const tx = asRecord(root.transaction) ?? root
  const message = asRecord(tx.message) ?? {}
  const keys = extractList<unknown>(message.accountKeys).map((item) => {
    if (typeof item === 'string') return item
    return asString(asRecord(item)?.pubkey)
  })
  const txMeta = asRecord(root.meta) ?? {}
  const idx = keys.findIndex((key) => sameAddress(key, address))
  const pre = extractList<unknown>(txMeta.preBalances)
  const post = extractList<unknown>(txMeta.postBalances)
  const fee = asBigInt(txMeta.fee)
  const drafts: HistoryTxDraft[] = []
  if (idx >= 0) {
    const before = asBigInt(pre[idx])
    const after = asBigInt(post[idx])
    const delta = after - before
    if (delta !== 0n) {
      const send = delta < 0n
      const amount = send ? -(delta + (sameAddress(keys[0] ?? '', address) ? fee : 0n)) : delta
      drafts.push({
        txid: signature,
        direction: send ? 'send' : 'receive',
        fromAddress: send ? address : keys[0] || '',
        toAddress: send ? keys.find((key) => !sameAddress(key, address)) || '' : address,
        amountMinor: amount > 0n ? amount : 0n,
        decimals: 9,
        symbol: 'SOL',
        contractAddress: null,
        feeMinor: send ? fee : null,
        status: meta.err ? 'failed' : 'confirmed',
        blockHeight: meta.slot || null,
        timestampMs: (meta.blockTime ?? 0) * 1000 || Date.now(),
      })
    }
  }
  const preTokens = extractList<unknown>(txMeta.preTokenBalances)
  const postTokens = extractList<unknown>(txMeta.postTokenBalances)
  const tokenMap = new Map<string, { mint: string; pre: bigint; post: bigint; decimals: number }>()
  for (const row of preTokens) {
    const item = asRecord(row)
    const owner = asString(item?.owner)
    if (!sameAddress(owner, address)) continue
    const mint = asString(item?.mint)
    const raw = asBigInt(asRecord(item?.uiTokenAmount)?.amount)
    const decimals = asNumber(asRecord(item?.uiTokenAmount)?.decimals, 9)
    if (!mint) continue
    tokenMap.set(mint, { mint, pre: raw, post: raw, decimals })
  }
  for (const row of postTokens) {
    const item = asRecord(row)
    const owner = asString(item?.owner)
    if (!sameAddress(owner, address)) continue
    const mint = asString(item?.mint)
    const raw = asBigInt(asRecord(item?.uiTokenAmount)?.amount)
    const decimals = asNumber(asRecord(item?.uiTokenAmount)?.decimals, 9)
    if (!mint) continue
    const prev = tokenMap.get(mint) ?? { mint, pre: 0n, post: 0n, decimals }
    prev.post = raw
    prev.decimals = decimals
    tokenMap.set(mint, prev)
  }
  for (const item of tokenMap.values()) {
    const delta = item.post - item.pre
    if (delta === 0n) continue
    drafts.push({
      txid: signature,
      direction: delta < 0n ? 'send' : 'receive',
      fromAddress: delta < 0n ? address : '',
      toAddress: delta < 0n ? '' : address,
      amountMinor: delta < 0n ? -delta : delta,
      decimals: item.decimals,
      symbol: 'SPL',
      contractAddress: item.mint,
      feeMinor: null,
      status: meta.err ? 'failed' : 'confirmed',
      blockHeight: meta.slot || null,
      timestampMs: (meta.blockTime ?? 0) * 1000 || Date.now(),
    })
  }
  return drafts.length
    ? drafts
    : [
        {
          txid: signature,
          direction: 'send',
          fromAddress: address,
          toAddress: '',
          amountMinor: 0n,
          decimals: 9,
          symbol: 'SOL',
          contractAddress: null,
          feeMinor: fee || null,
          status: meta.err ? 'failed' : 'confirmed',
          blockHeight: meta.slot || null,
          timestampMs: (meta.blockTime ?? 0) * 1000 || Date.now(),
        },
      ]
}
