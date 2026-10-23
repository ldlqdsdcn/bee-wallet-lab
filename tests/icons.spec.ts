import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC, IPC_CHANNELS } from '../shared/ipc'
import {
  displayIconSrc,
  findIconFile,
  hashIconKey,
  importIconBytes,
  parseIconDisplayUrl,
  parseStoredIcon,
  setIconsRootForTests,
  sniffImage,
} from '../electron/main/catalog/icons'

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
)

describe('目录图标缓存', () => {
  it('通道已加入白名单', () => {
    expect(IPC.catalogIconResolve).toBe('catalog:icon:resolve')
    expect(IPC.catalogIconUpload).toBe('catalog:icon:upload')
    expect(IPC_CHANNELS).toContain(IPC.catalogIconResolve)
    expect(IPC_CHANNELS).toContain(IPC.catalogIconUpload)
  })

  it('识别 http / 本地引用 / 空值', () => {
    expect(parseStoredIcon('')).toEqual({ kind: 'empty' })
    expect(parseStoredIcon('https://example.com/a.png')).toMatchObject({
      kind: 'remote',
      url: 'https://example.com/a.png',
      id: hashIconKey('https://example.com/a.png'),
    })
    expect(parseStoredIcon('icon:aaaaaaaaaaaaaaaa.png')).toEqual({
      kind: 'local',
      id: 'aaaaaaaaaaaaaaaa',
      ext: 'png',
    })
    expect(parseIconDisplayUrl('bee-icon://icon/aaaaaaaaaaaaaaaa.png')).toEqual({
      id: 'aaaaaaaaaaaaaaaa',
      ext: 'png',
    })
    expect(displayIconSrc('aaaaaaaaaaaaaaaa', 'png')).toBe('bee-icon://icon/aaaaaaaaaaaaaaaa.png')
  })

  it('按内容写入本地缓存', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bee-icons-'))
    setIconsRootForTests(root)
    expect(sniffImage(PNG)).toEqual({ ext: 'png', mime: 'image/png' })
    const ref = importIconBytes(PNG, root)
    expect(ref.startsWith('icon:')).toBe(true)
    const id = ref.slice('icon:'.length).split('.')[0] ?? ''
    expect(findIconFile(id, root)?.ext).toBe('png')
    setIconsRootForTests(null)
  })

  it('拒绝非图片内容', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bee-icons-'))
    writeFileSync(path.join(root, 'x.txt'), 'hello')
    expect(sniffImage(Buffer.from('hello'))).toBeNull()
    expect(() => importIconBytes(Buffer.from('<html>nope</html>'), root)).toThrow(/图片/)
  })
})
