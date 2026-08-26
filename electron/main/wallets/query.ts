export const WALLET_PICKER_PAGE_SIZE = 30

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export function normalizePickerQuery(input: { name?: string; page?: number; pageSize?: number }): {
  name: string
  page: number
  pageSize: number
} {
  const rawSize = input.pageSize ?? WALLET_PICKER_PAGE_SIZE
  const pageSize = Number.isFinite(rawSize) ? Math.min(100, Math.max(1, Math.floor(rawSize))) : WALLET_PICKER_PAGE_SIZE
  const rawPage = input.page ?? 1
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1
  return { name: input.name?.trim() ?? '', page, pageSize }
}
