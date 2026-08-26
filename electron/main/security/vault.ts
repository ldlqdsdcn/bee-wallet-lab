/**
 * 保险库：主密码生命周期与 KEK 内存驻留。
 *
 * 安全约束：
 * - KEK 只存在于主进程内存，永不落盘、永不跨进程传递
 * - 锁定时立即清零 KEK 缓冲区
 * - 解锁失败按次数递增延迟惩罚，抑制离线爆破
 * - 空闲超过 autoLockMinutes 自动锁定；渲染进程通过 vault:touch 续期
 */
import type { VaultStatus } from '../../../shared/types'
import {
  assertPasswordStrength,
  createKdfDescriptor,
  createVerifier,
  decryptSecret,
  deriveKek,
  encryptSecret,
  verifyKek,
  wipe,
  type KdfDescriptor,
} from './crypto'
import { loadSettings, loadVaultMeta, saveSettings, saveVaultMeta } from '../db/repos/metaRepo'

/** 失败次数 -> 惩罚延迟（毫秒） */
const LOCKOUT_LADDER = [0, 0, 0, 5_000, 15_000, 60_000, 300_000]

export type VaultEvent = 'locked' | 'unlocked'

interface VaultState {
  kek: Buffer | null
  kdf: KdfDescriptor | null
  verifier: string | null
  failedAttempts: number
  lockoutUntil: number | null
  lastActivityAt: number
  autoLockMinutes: number
}

const state: VaultState = {
  kek: null,
  kdf: null,
  verifier: null,
  failedAttempts: 0,
  lockoutUntil: null,
  lastActivityAt: Date.now(),
  autoLockMinutes: 5,
}

let idleTimer: NodeJS.Timeout | null = null
const listeners = new Set<(event: VaultEvent) => void>()

export function onVaultEvent(listener: (event: VaultEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: VaultEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error('[vault] listener error', err)
    }
  }
}

/** 应用启动时调用：读取 KDF 元信息与自动锁定配置。 */
export function initVault(): void {
  const meta = loadVaultMeta()
  if (meta) {
    state.kdf = meta.kdf
    state.verifier = meta.verifier
  }
  state.autoLockMinutes = loadSettings().autoLockMinutes
}

export function isInitialized(): boolean {
  return state.kdf !== null && state.verifier !== null
}

export function isUnlocked(): boolean {
  return state.kek !== null
}

export function getStatus(): VaultStatus {
  return {
    initialized: isInitialized(),
    unlocked: isUnlocked(),
    autoLockMinutes: state.autoLockMinutes,
    failedAttempts: state.failedAttempts,
    lockoutUntil: state.lockoutUntil,
  }
}

/** 首次设置主密码。 */
export function initialize(password: string): VaultStatus {
  if (isInitialized()) throw new Error('主密码已设置，请使用解锁或修改密码')
  assertPasswordStrength(password)

  const kdf = createKdfDescriptor()
  const kek = deriveKek(password, kdf)
  const verifier = createVerifier(kek)
  saveVaultMeta(kdf, verifier)

  state.kdf = kdf
  state.verifier = verifier
  state.kek = kek
  state.failedAttempts = 0
  state.lockoutUntil = null
  touch()
  emit('unlocked')
  return getStatus()
}

export function unlock(password: string): VaultStatus {
  if (!isInitialized() || !state.kdf || !state.verifier) {
    throw new Error('尚未设置主密码')
  }
  const now = Date.now()
  if (state.lockoutUntil && now < state.lockoutUntil) {
    const seconds = Math.ceil((state.lockoutUntil - now) / 1000)
    throw new Error(`尝试过于频繁，请在 ${seconds} 秒后重试`)
  }

  const candidate = deriveKek(password, state.kdf)
  if (!verifyKek(candidate, state.verifier)) {
    wipe(candidate)
    state.failedAttempts += 1
    const penalty = LOCKOUT_LADDER[Math.min(state.failedAttempts, LOCKOUT_LADDER.length - 1)]
    state.lockoutUntil = penalty > 0 ? Date.now() + penalty : null
    throw new Error('主密码不正确')
  }

  wipe(state.kek)
  state.kek = candidate
  state.failedAttempts = 0
  state.lockoutUntil = null
  touch()
  emit('unlocked')
  return getStatus()
}

export function lock(): VaultStatus {
  const wasUnlocked = isUnlocked()
  wipe(state.kek)
  state.kek = null
  clearIdleTimer()
  if (wasUnlocked) emit('locked')
  return getStatus()
}

/**
 * 修改主密码：用旧密码解出全部密文，再用新 KEK 重新加密。
 * @param reencrypt 由调用方提供的重加密回调，在同一事务内完成密文迁移
 */
export function changePassword(
  oldPassword: string,
  newPassword: string,
  reencrypt: (oldKek: Buffer, newKek: Buffer) => void,
): VaultStatus {
  if (!isInitialized() || !state.kdf || !state.verifier) throw new Error('尚未设置主密码')
  assertPasswordStrength(newPassword)

  const oldKek = deriveKek(oldPassword, state.kdf)
  if (!verifyKek(oldKek, state.verifier)) {
    wipe(oldKek)
    throw new Error('原主密码不正确')
  }

  const nextKdf = createKdfDescriptor()
  const newKek = deriveKek(newPassword, nextKdf)
  try {
    reencrypt(oldKek, newKek)
    saveVaultMeta(nextKdf, createVerifier(newKek))
    state.kdf = nextKdf
    state.verifier = createVerifier(newKek)
    wipe(state.kek)
    state.kek = newKek
    touch()
  } catch (err) {
    wipe(newKek)
    throw err
  } finally {
    wipe(oldKek)
  }
  return getStatus()
}

/** 二次确认主密码（导出助记词 / 揭示私钥）。不改变解锁状态。 */
export function verifyPassword(password: string): boolean {
  if (!isInitialized() || !state.kdf || !state.verifier) return false
  const candidate = deriveKek(password, state.kdf)
  try {
    return verifyKek(candidate, state.verifier)
  } finally {
    wipe(candidate)
  }
}

/** 取用 KEK：仅供主进程内部模块调用。 */
export function requireKek(): Buffer {
  if (!state.kek) throw new Error('LOCKED')
  touch()
  return state.kek
}

export function encryptWithVault(plaintext: string | Buffer, aad?: string): string {
  return encryptSecret(requireKek(), plaintext, aad)
}

export function decryptWithVault(packed: string, aad?: string): string {
  return decryptSecret(requireKek(), packed, aad)
}

/* ------------------------------- 自动锁定 ------------------------------- */

export function setAutoLockMinutes(minutes: number): void {
  const value = Math.max(0, Math.floor(minutes))
  state.autoLockMinutes = value
  saveSettings({ autoLockMinutes: value })
  if (isUnlocked()) scheduleIdleTimer()
}

/** 记录一次用户活动，重置空闲计时。 */
export function touch(): void {
  state.lastActivityAt = Date.now()
  if (isUnlocked()) scheduleIdleTimer()
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function scheduleIdleTimer(): void {
  clearIdleTimer()
  // 0 表示不自动锁定
  if (state.autoLockMinutes <= 0) return
  const timeout = state.autoLockMinutes * 60_000
  idleTimer = setTimeout(() => {
    if (Date.now() - state.lastActivityAt >= timeout) {
      lock()
    } else {
      scheduleIdleTimer()
    }
  }, timeout)
  idleTimer.unref?.()
}

/** 进程退出前调用。 */
export function disposeVault(): void {
  lock()
  listeners.clear()
}
