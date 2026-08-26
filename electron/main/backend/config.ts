/**
 * 后端配置读取。集中一处，避免各模块各自拼 baseUrl。
 */
import { loadSettings } from '../db/repos/metaRepo'

/** 去掉尾部斜杠，便于与路径拼接 */
export function getBaseUrl(): string {
  return loadSettings().baseUrl.trim().replace(/\/+$/, '')
}

/** 预留给后端 i18n 的 x-language 头 */
export function getLanguage(): string {
  return loadSettings().language || 'zh-CN'
}
