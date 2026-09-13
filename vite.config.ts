import { defineConfig, type Plugin } from 'vite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { build as esbuild } from 'esbuild'
import electronSimple from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sharedAlias = {
  '@shared': path.join(__dirname, 'shared'),
}

/** 不走 vite-plugin-electron：第三套 watch 会在主进程打完前就 reload，把 esbuild 打成 EPIPE。 */
function dappPreloadPlugin(): Plugin {
  const entry = path.join(__dirname, 'electron/dapp-preload.ts')
  const inject = path.join(__dirname, 'electron/dapp-inject.ts')
  const info = path.join(__dirname, 'electron/dapp-provider-info.ts')
  const icon = path.join(__dirname, 'electron/dapp-icon-data.ts')
  const outfile = path.join(__dirname, 'dist-electron/dapp-preload.mjs')

  const write = async () => {
    mkdirSync(path.dirname(outfile), { recursive: true })
    await esbuild({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      logLevel: 'silent',
    })
  }

  return {
    name: 'dapp-preload',
    async buildStart() {
      this.addWatchFile(entry)
      this.addWatchFile(inject)
      this.addWatchFile(info)
      this.addWatchFile(icon)
      await write()
    },
    configureServer(server) {
      server.watcher.add(entry)
      server.watcher.add(inject)
      server.watcher.add(info)
      server.watcher.add(icon)
      server.watcher.on('change', (file) => {
        const resolved = path.resolve(file)
        if (resolved === entry || resolved === inject || resolved === info || resolved === icon) void write()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: sharedAlias,
  },
  plugins: [
    react(),
    tailwindcss(),
    dappPreloadPlugin(),
    electronSimple({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
        vite: {
          envPrefix: ['VITE_', 'WALLET_'],
          resolve: { alias: sharedAlias },
          build: {
            rollupOptions: {
              // 原生 / 可选原生模块不能打进 bundle：运行时从 node_modules 加载
              external: ['better-sqlite3', 'ws', 'bufferutil', 'utf-8-validate'],
              treeshake: {
                moduleSideEffects: true,
              },
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          resolve: { alias: sharedAlias },
        },
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
