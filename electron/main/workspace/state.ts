import fs from 'node:fs'
import path from 'node:path'
import { createWorkspace, DB_FILE, DEFAULT_WORKSPACE_NAME, ENV_FILE, validateWorkspace, writeJson } from './files'
import { seedEnvironment, setWorkspaceEnvironment, validateEnvironment } from './environment'

let activeDirectory = ''
let stateFile = ''

export function getWorkspaceDirectory(): string {
  if (!activeDirectory) throw new Error('Workspace not initialized')
  return activeDirectory
}

/** Called before Electron creates any sessions. Keep userData stable for its single-instance lock. */
export function initializeWorkspace(userData: string): string {
  stateFile = path.join(userData, 'workspace-state.json')
  fs.mkdirSync(userData, { recursive: true })
  let directory = path.join(userData, DEFAULT_WORKSPACE_NAME)
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (state?.version !== 1 || typeof state.activeDirectory !== 'string' || !path.isAbsolute(state.activeDirectory)) {
      throw new Error('Invalid workspace-state.json')
    }
    directory = state.activeDirectory
  } else if (!fs.existsSync(directory)) {
    // Retain the legacy files as a recovery copy. A failed migration never changes the selection.
    createWorkspace(directory, seedEnvironment(), userData)
  }
  validateWorkspace(directory)
  assertWritable(directory)
  directory = fs.realpathSync(directory)
  setWorkspaceEnvironment(validateEnvironment(JSON.parse(fs.readFileSync(path.join(directory, ENV_FILE), 'utf8'))))
  writeJson(stateFile, { version: 1, activeDirectory: directory })
  activeDirectory = directory
  return directory
}

function assertWritable(directory: string): void {
  fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK)
  fs.accessSync(path.join(directory, DB_FILE), fs.constants.R_OK | fs.constants.W_OK)
}

export function selectWorkspace(directory: string): void {
  validateWorkspace(directory)
  assertWritable(directory)
  if (!stateFile) throw new Error('Workspace state not initialized')
  writeJson(stateFile, { version: 1, activeDirectory: fs.realpathSync(directory) })
  // The active process retains its old directory until restart; background jobs cannot cross databases.
}
