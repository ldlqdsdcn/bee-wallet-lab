import { protocol } from 'electron'
import { ICON_SCHEME, serveCatalogIcon } from './icons'

export function installCatalogIconProtocol(): void {
  try {
    protocol.handle(ICON_SCHEME, async (request) => {
      try {
        const file = await serveCatalogIcon(request.url)
        if (!file) return new Response('', { status: 404 })
        return new Response(Uint8Array.from(file.bytes), {
          headers: {
            'Content-Type': file.mime,
            'Cache-Control': 'public, max-age=31536000',
          },
        })
      } catch {
        return new Response('', { status: 404 })
      }
    })
  } catch {
    /* 重复注册时跳过 */
  }
}
