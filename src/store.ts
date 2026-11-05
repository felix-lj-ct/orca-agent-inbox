// The files the plugin owns outside Orca: what it installs into ~/.config/agent-inbox for agents and
// scripts, and the log, which it prunes under the same lock the CLI appends under.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configDir, type InboxConfig, renderEnv } from './config'
import { type Entry, keepLines, parseLog } from './log'
import type { Setup } from './protocol'

/** The CLI breaks a lock it waited ~5 s for; one this old was left by a killed process. */
const STALE_LOCK_MS = 10_000

/** Writes a file only when its content changed, through a temporary file so a reader never sees half. */
function writeIfChanged(path: string, content: string, mode?: number): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, content)
  if (mode !== undefined) chmodSync(tmp, mode)
  renameSync(tmp, path)
}

/**
 * Installs the CLI, config.env and the agent guide from the plugin folder into ~/.config/agent-inbox,
 * where agents find them whatever version of the plugin is installed, and creates the log's folder.
 */
export function install(config: InboxConfig, home: string, pluginRoot: string): Setup {
  const dir = configDir(home)
  const setup: Setup = { cli: join(dir, 'bin', 'agent-inbox'), guide: join(dir, 'agent-guide.md'), log: config.logPath }
  writeIfChanged(setup.cli, readFileSync(join(pluginRoot, 'cli', 'agent-inbox.sh'), 'utf8'), 0o755)
  writeIfChanged(join(dir, 'config.env'), renderEnv(config))
  writeIfChanged(setup.guide, readFileSync(join(pluginRoot, 'guide', 'agent-guide.md'), 'utf8'))
  mkdirSync(dirname(config.logPath), { recursive: true })
  return setup
}

/** Runs fn holding the log's lock; undefined when someone else holds it. */
function withLock<T>(logPath: string, fn: () => T): T | undefined {
  const lock = `${logPath}.lock`
  try {
    mkdirSync(lock)
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs < STALE_LOCK_MS) return undefined
      rmSync(lock, { recursive: true, force: true })
      mkdirSync(lock)
    } catch {
      return undefined
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

/** Drops the log lines past the retention window (see keepLines); returns how many went. */
export function prune(config: InboxConfig, now = Date.now()): number {
  if (!existsSync(config.logPath)) return 0
  const removed = withLock(config.logPath, () => {
    const lines = readFileSync(config.logPath, 'utf8').split('\n').filter((line) => line.trim())
    const kept = keepLines(lines, now, config.retentionDays)
    if (kept.length === lines.length) return 0
    const tmp = `${config.logPath}.tmp-${process.pid}`
    writeFileSync(tmp, kept.map((line) => `${line}\n`).join(''))
    renameSync(tmp, config.logPath)
    return lines.length - kept.length
  })
  return removed ?? 0
}

export function readEntries(logPath: string): Entry[] {
  return existsSync(logPath) ? parseLog(readFileSync(logPath, 'utf8')) : []
}
