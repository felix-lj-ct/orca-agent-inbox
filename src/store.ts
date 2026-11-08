// The files the plugin owns outside Orca: what it installs into ~/.config/agent-inbox for agents and
// scripts, the log, which it prunes under the same lock the CLI appends under, and the points beside it.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configDir, type InboxConfig, renderConfig } from './config'
import { type Entry, keepLines, parseLog } from './log'
import { parsePoints, pointsPath } from './points'
import type { Setup, WiredPoint } from './protocol'

/** The CLI breaks a lock it waited ~5 s for; one this old was left by a killed process. */
const STALE_LOCK_MS = 10_000

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Replaces a file; on Windows a reader such as a virus scanner can hold it for a moment. */
function replace(from: string, to: string): void {
  for (let tries = 0; ; tries++) {
    try {
      return renameSync(from, to)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (tries >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw e
      sleep(50)
    }
  }
}

/** Writes a file only when its content changed, through a temporary file so a reader never sees half. */
function writeIfChanged(path: string, content: string, mode?: number): void {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, content)
  if (mode !== undefined) chmodSync(tmp, mode)
  replace(tmp, path)
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/** What the Windows side of WSL's interop gets from WSL: only the variables WSLENV names, paths translated (/p). */
const WSLENV = [
  'ELECTRON_RUN_AS_NODE/w',
  'AGENT_INBOX_WSL_CWD/w',
  'AGENT_INBOX_WSL_TOP/w',
  'ORCA_TERMINAL_HANDLE/w',
  'ORCA_CLI_CWD/w',
  'AGENT_INBOX_LOG/p',
  'AGENT_INBOX_WAITING/w',
  'AGENT_INBOX_RESUME/w',
  'AGENT_INBOX_ORCA/p'
].join(':')

/**
 * bin/agent-inbox: runs the CLI on the runtime of the Orca that installed it, else on the first node on PATH.
 * On Windows it serves Git Bash, which would otherwise turn arguments that look like paths into Windows paths,
 * and WSL, which reaches it through ~/.config/agent-inbox there (a link to this folder; see src/wsl.ts): there it
 * runs the CLI on Windows through WSL's interop, on Orca's runtime and never on WSL's node, since the log, the
 * settings and the orca CLI are Windows ones. The CLI gets the directory and its Git top level as WSL has them.
 * As Orca's own orca command in WSL does, it runs the Windows side in a Windows folder (one started in a WSL folder
 * gets a \\wsl.localhost\... path as its own, which Node trips over) and tells the orca CLI the directory in
 * ORCA_CLI_CWD, from which it knows the distro.
 */
export function shLauncher(runtime: string, script: string, platform: string = process.platform): string {
  const path = (p: string) => shellQuote(platform === 'win32' ? p.replaceAll('\\', '/') : p)
  const wsl = [
    'if [ -n "${WSL_DISTRO_NAME:-}" ]; then',
    `  rt=$(wslpath -u ${shellQuote(runtime)} 2>/dev/null) && [ -x "$rt" ] || { echo "agent-inbox: Orca is not where it was; open Orca to reinstall this CLI" >&2; exit 3; }`,
    '  top=$(git rev-parse --show-toplevel 2>/dev/null) || top=',
    '  cwd=$(wslpath -w "$PWD" 2>/dev/null) || cwd=',
    `  export ELECTRON_RUN_AS_NODE=1 AGENT_INBOX_WSL_CWD="$PWD" AGENT_INBOX_WSL_TOP="$top" ORCA_CLI_CWD="$cwd" WSLENV='${WSLENV}'`,
    '  cd "${rt%/*}"',
    `  exec "$rt" ${path(script)} "$@"`,
    'fi'
  ]
  return [
    '#!/bin/sh',
    '# agent-inbox: the Agent Inbox CLI. The Agent Inbox Orca plugin writes this file whenever Orca starts it or its',
    '# settings change: edits here are overwritten. It runs lib/agent-inbox.mjs on Orca\'s runtime, else on node.',
    `rt=${path(runtime)}`,
    ...(platform === 'win32' ? wsl : []),
    'if [ ! -x "$rt" ]; then',
    '  rt=$(command -v node) || { echo "agent-inbox: Orca is not where it was and node is not on PATH; open Orca to reinstall this CLI" >&2; exit 3; }',
    'fi',
    ...(platform === 'win32' ? ["export MSYS2_ARG_CONV_EXCL='*'"] : []),
    // as Orca's own launcher does: Electron refuses them from another program, and says so on every call
    'unset NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE',
    `ELECTRON_RUN_AS_NODE=1 exec "$rt" ${path(script)} "$@"`,
    ''
  ].join('\n')
}

/**
 * bin/agent-inbox.cmd, for PowerShell and cmd on Windows: the same as bin/agent-inbox. cmd reads it in the
 * console's code page, not UTF-8, so it holds no user name: the CLI is found from the file's own folder (%~dp0),
 * and a runtime in the home folder (Orca installs into AppData\Local\Programs) is written from %USERPROFILE%.
 * CRLF, since cmd misreads labels in a file without it.
 */
export function cmdLauncher(runtime: string, home: string): string {
  const inHome = runtime.toLowerCase().startsWith(`${home.toLowerCase()}\\`)
  // % would start a variable
  const rt = inHome ? `%USERPROFILE%${runtime.slice(home.length).replaceAll('%', '%%')}` : runtime.replaceAll('%', '%%')
  return [
    '@echo off',
    'rem agent-inbox: the Agent Inbox CLI. The Agent Inbox Orca plugin writes this file whenever Orca starts it or its',
    "rem settings change: edits here are overwritten. It runs ..\\lib\\agent-inbox.mjs on Orca's runtime, else on node.",
    'setlocal',
    `set "RT=${rt}"`,
    'if exist "%RT%" goto run',
    'set "RT=node"',
    'where node >nul 2>nul && goto run',
    'echo agent-inbox: Orca is not where it was and node is not on PATH; open Orca to reinstall this CLI 1>&2',
    'exit /b 3',
    ':run',
    'set ELECTRON_RUN_AS_NODE=1',
    'set NODE_OPTIONS=',
    'set NODE_REPL_EXTERNAL_MODULE=',
    '"%RT%" "%~dp0..\\lib\\agent-inbox.mjs" %*',
    'exit /b %ERRORLEVEL%',
    ''
  ].join('\r\n')
}

/** The CLI as the panel shows it: on Windows the launcher that PowerShell and cmd run. */
export const cliPath = (home: string, platform: string = process.platform) =>
  join(configDir(home), 'bin', platform === 'win32' ? 'agent-inbox.cmd' : 'agent-inbox')

/**
 * Installs the CLI with its launchers, config.json and the agent guide from the plugin folder into
 * ~/.config/agent-inbox, where agents find them whatever version of the plugin is installed, and creates the
 * log's folder. The launchers run the CLI on runtime: this worker's, which is Orca's own.
 */
export function install(config: InboxConfig, home: string, pluginRoot: string, runtime = process.execPath, platform = process.platform): Setup {
  const dir = configDir(home)
  const script = join(dir, 'lib', 'agent-inbox.mjs')
  const setup: Setup = { cli: cliPath(home, platform), guide: join(dir, 'agent-guide.md'), log: config.logPath }
  writeIfChanged(script, readFileSync(join(pluginRoot, 'cli', 'agent-inbox.mjs'), 'utf8'))
  writeIfChanged(join(dir, 'bin', 'agent-inbox'), shLauncher(runtime, script, platform), 0o755)
  if (platform === 'win32') writeIfChanged(join(dir, 'bin', 'agent-inbox.cmd'), cmdLauncher(runtime, home))
  writeIfChanged(join(dir, 'config.json'), renderConfig(config))
  // the settings file of the shell CLI up to 0.1.2
  rmSync(join(dir, 'config.env'), { force: true })
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
    replace(tmp, config.logPath)
    return lines.length - kept.length
  })
  return removed ?? 0
}

export function readEntries(logPath: string): Entry[] {
  return existsSync(logPath) ? parseLog(readFileSync(logPath, 'utf8')) : []
}

/** The points recorded beside the log; none before the first `agent-inbox point add`. */
export function readPoints(logPath: string): WiredPoint[] {
  const path = pointsPath(logPath)
  return existsSync(path) ? parsePoints(readFileSync(path, 'utf8')) : []
}
