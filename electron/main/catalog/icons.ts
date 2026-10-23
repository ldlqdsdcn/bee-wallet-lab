/**
 * 目录图标：工作区 icons/ 本地缓存。
 * http(s) 首次按 URL 下载；自定义上传直接写入。展示统一走 bee-icon://。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getWorkspaceDirectory } from '../workspace/state'
import { proxiedFetch } from '../net/proxy'
import { invalidArg } from '../ipc/registry'

export const ICON_REF_PREFIX = 'icon:'
export const ICON_SCHEME = 'bee-icon'
export const ICONS_DIR_NAME = 'icons'
export const MAX_ICON_BYTES = 1_500_000

const ID_RE = /^[a-f0-9]{16,64}$/
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
}

export type StoredIcon =
  | { kind: 'empty' }
  | { kind: 'local'; id: string; ext: string }
  | { kind: 'remote'; url: string; id: string }

let overrideRoot: string | null = null

export function setIconsRootForTests(root: string | null): void {
  overrideRoot = root
}

export function iconsDirectory(): string {
  const root = overrideRoot ?? path.join(getWorkspaceDirectory(), ICONS_DIR_NAME)
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function hashIconKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export function parseStoredIcon(value: string | null | undefined): StoredIcon {
  const raw = value?.trim() ?? ''
  if (!raw) return { kind: 'empty' }
  if (raw.startsWith(ICON_REF_PREFIX)) {
    const name = raw.slice(ICON_REF_PREFIX.length)
    const parsed = parseIconFileName(name)
    return parsed ? { kind: 'local', ...parsed } : { kind: 'empty' }
  }
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'remote', url: raw, id: hashIconKey(raw) }
    }
  } catch {
    /* not a url */
  }
  if (raw.startsWith(`${ICON_SCHEME}:`)) {
    const file = parseIconDisplayUrl(raw)
    return file ? { kind: 'local', ...file } : { kind: 'empty' }
  }
  return { kind: 'empty' }
}

export function displayIconSrc(id: string, ext: string): string {
  return `${ICON_SCHEME}://icon/${id}.${normalizeExt(ext)}`
}

export function parseIconDisplayUrl(url: string): { id: string; ext: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${ICON_SCHEME}:`) return null
    const name = decodeURIComponent((parsed.pathname || '').replace(/^\/+/, '') || parsed.hostname)
    return parseIconFileName(name)
  } catch {
    return null
  }
}

export function parseIconFileName(name: string): { id: string; ext: string } | null {
  const match = /^([a-f0-9]{16,64})\.([a-z0-9]+)$/i.exec(name.trim())
  if (!match) return null
  const ext = normalizeExt(match[2] ?? '')
  if (!EXT_MIME[ext] || !ID_RE.test(match[1] ?? '')) return null
  return { id: match[1]!.toLowerCase(), ext }
}

export function sniffImage(bytes: Buffer): { ext: string; mime: string } | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', mime: EXT_MIME.png }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: EXT_MIME.jpg }
  }
  if (bytes.toString('ascii', 0, 4) === 'GIF8') return { ext: 'gif', mime: EXT_MIME.gif }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: EXT_MIME.webp }
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return { ext: 'ico', mime: EXT_MIME.ico }
  }
  const head = bytes.subarray(0, 256).toString('utf8').trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return { ext: 'svg', mime: EXT_MIME.svg }
  }
  return null
}

export function findIconFile(id: string, root = iconsDirectory()): { file: string; ext: string } | null {
  if (!ID_RE.test(id)) return null
  const dir = path.resolve(root)
  for (const ext of Object.keys(EXT_MIME)) {
    const file = path.join(dir, `${id}.${ext}`)
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return { file, ext }
  }
  return null
}

export function writeIconBytes(id: string, bytes: Buffer, ext: string, root = iconsDirectory()): string {
  if (!ID_RE.test(id)) throw invalidArg('图标 id 无效')
  if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) throw invalidArg('图标文件过大或为空')
  const safeExt = normalizeExt(ext)
  if (!EXT_MIME[safeExt]) throw invalidArg('不支持的图片格式')
  const dir = path.resolve(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.${safeExt}`)
  fs.writeFileSync(file, bytes, { mode: 0o600 })
  return file
}

export function importIconBytes(bytes: Buffer, root = iconsDirectory()): string {
  const sniffed = sniffImage(bytes)
  if (!sniffed) throw invalidArg('不是支持的图片文件')
  const id = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  writeIconBytes(id, bytes, sniffed.ext, root)
  return `${ICON_REF_PREFIX}${id}.${sniffed.ext}`
}

export function importIconFile(filePath: string, root = iconsDirectory()): string {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  if (!stat.isFile()) throw invalidArg('请选择图片文件')
  if (stat.size > MAX_ICON_BYTES) throw invalidArg('图标不能超过 1.5 MB')
  return importIconBytes(fs.readFileSync(resolved), root)
}

export function readIconFile(id: string, ext?: string, root = iconsDirectory()): { bytes: Buffer; mime: string } | null {
  const found = ext
    ? (() => {
        const file = path.join(path.resolve(root), `${id}.${normalizeExt(ext)}`)
        return fs.existsSync(file) ? { file, ext: normalizeExt(ext) } : null
      })()
    : findIconFile(id, root)
  if (!found) return null
  const bytes = fs.readFileSync(found.file)
  return { bytes, mime: EXT_MIME[found.ext] ?? 'application/octet-stream' }
}

export async function ensureCatalogIcon(value: string, root = iconsDirectory()): Promise<string | null> {
  const stored = parseStoredIcon(value)
  if (stored.kind === 'empty') return null
  if (stored.kind === 'local') {
    const found = findIconFile(stored.id, root)
    return found ? displayIconSrc(stored.id, found.ext) : null
  }
  const existing = findIconFile(stored.id, root)
  if (existing) return displayIconSrc(stored.id, existing.ext)
  const bytes = await downloadIcon(stored.url)
  const sniffed = sniffImage(bytes)
  if (!sniffed) throw invalidArg('远程图标不是图片')
  writeIconBytes(stored.id, bytes, sniffed.ext, root)
  rememberRemote(stored.id, stored.url, sniffed.ext, root)
  return displayIconSrc(stored.id, sniffed.ext)
}

export async function serveCatalogIcon(url: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const parsed = parseIconDisplayUrl(url) ?? parseIconFileName(url.replace(/^bee-icon:\/\//i, ''))
  if (!parsed) return null
  const cached = readIconFile(parsed.id, parsed.ext)
  if (cached) return cached
  const remote = lookupRemote(parsed.id)
  if (!remote) return readIconFile(parsed.id)
  return (await ensureCatalogIcon(remote)) ? readIconFile(parsed.id) : null
}

async function downloadIcon(url: string): Promise<Buffer> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw invalidArg('图标地址必须是 http(s)')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await proxiedFetch(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'image/*,*/*;q=0.8' } })
    if (response.status < 200 || response.status >= 300) throw invalidArg(`下载图标失败（${response.status}）`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) throw invalidArg('远程图标过大或为空')
    return buffer
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw invalidArg('下载图标超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function rememberRemote(id: string, url: string, ext: string, root: string): void {
  const file = path.join(root, 'index.json')
  const table = readIndex(file)
  table[id] = { url, ext }
  fs.writeFileSync(file, JSON.stringify(table), { mode: 0o600 })
}

function lookupRemote(id: string): string | null {
  const table = readIndex(path.join(iconsDirectory(), 'index.json'))
  return table[id]?.url ?? null
}

function readIndex(file: string): Record<string, { url: string; ext: string }> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, { url: string; ext: string }>) : {}
  } catch {
    return {}
  }
}

function normalizeExt(ext: string): string {
  const value = ext.trim().toLowerCase()
  return value === 'jpeg' ? 'jpg' : value
}
