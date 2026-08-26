import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 单测配置独立于 vite.config.ts：
 * 避免加载 electron 插件，测试只跑纯逻辑（派生、加密、编码）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.join(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
