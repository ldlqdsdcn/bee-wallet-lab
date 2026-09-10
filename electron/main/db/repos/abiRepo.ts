/**
 * 本地 ABI 库。ABI 是公开描述，明文入库。
 */
import type { AbiContractRecord } from '../../../../shared/types'
import { getDatabase } from '../sqlite'

interface AbiRow {
  id: string
  name: string
  contract_address: string | null
  abi_json: string
  function_count: number
  event_count: number
  created_at: number
  updated_at: number
}

function toRecord(row: AbiRow): AbiContractRecord {
  return {
    id: row.id,
    name: row.name,
    contractAddress: row.contract_address,
    abiJson: row.abi_json,
    functionCount: row.function_count,
    eventCount: row.event_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listAbiContracts(): AbiContractRecord[] {
  return getDatabase()
    .prepare<[], AbiRow>('SELECT * FROM abi_contracts ORDER BY updated_at DESC, name ASC')
    .all()
    .map(toRecord)
}

export function getAbiContract(id: string): AbiContractRecord | null {
  const row = getDatabase().prepare<[string], AbiRow>('SELECT * FROM abi_contracts WHERE id = ?').get(id)
  return row ? toRecord(row) : null
}

export function insertAbiContract(input: {
  id: string
  name: string
  contractAddress: string | null
  abiJson: string
  functionCount: number
  eventCount: number
}): AbiContractRecord {
  const now = Date.now()
  getDatabase()
    .prepare(
      `INSERT INTO abi_contracts (
         id, name, contract_address, abi_json, function_count, event_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.name,
      input.contractAddress,
      input.abiJson,
      input.functionCount,
      input.eventCount,
      now,
      now,
    )
  return getAbiContract(input.id) as AbiContractRecord
}

export function updateAbiContract(input: {
  id: string
  name: string
  contractAddress: string | null
  abiJson: string
  functionCount: number
  eventCount: number
}): AbiContractRecord {
  const now = Date.now()
  getDatabase()
    .prepare(
      `UPDATE abi_contracts
          SET name = ?, contract_address = ?, abi_json = ?, function_count = ?, event_count = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(input.name, input.contractAddress, input.abiJson, input.functionCount, input.eventCount, now, input.id)
  return getAbiContract(input.id) as AbiContractRecord
}

export function deleteAbiContract(id: string): void {
  getDatabase().prepare('DELETE FROM abi_contracts WHERE id = ?').run(id)
}
