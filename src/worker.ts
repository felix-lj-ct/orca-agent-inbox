// Agent Inbox's worker. On start and on every settings change it installs the CLI, config.env and the
// agent guide into ~/.config/agent-inbox and prunes the log to the retention window, then prunes again
// every hour. It answers the panel from the log and the Orca board, which it reads through the orca CLI
// (the host API has no board), lists the points recorded beside the log, starts the agent that adds, removes
// or aligns them, and tells open panels when the log or the points change. Orca starts it for a panel request
// and stops it when idle.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile, spawn } from 'node:child_process'
import { existsSync, type FSWatcher, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitingItems } from './board'
import { configDir, type InboxConfig, readConfig } from './config'
import { activeProfileDir, activeWorkspace, defaultAgent, orcaDataDir } from './launch'
import { messageId, openAsks, recentMessages } from './log'
import { pointsPath } from './points'
import type { ActionResult, Inbox, Setup } from './protocol'
import { install, prune, readEntries, readPoints } from './store'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'cli', 'agent-inbox.sh')
const PRUNE_MS = 3600_000
/** Ids of the read messages inside the retention window. */
const READ = 'read'
/** Before read and unread, hidden messages; they count as read. */
const DISMISSED = 'dismissed'
/** false while the setup task waits, true once handled; unset until the first start decides. */
const SETUP_DONE = 'setupDone'
/** Node has no clipboard: the first of these that runs wins. */
const CLIPBOARD: Record<string, string[][]> = {
  darwin: [['pbcopy']],
  linux: [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
}
const ORCA_APP_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'
/** orca CLI JSON, read field by field */
type Raw = any

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// The worker does not get a login shell's PATH.
const searchPath = () => [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].filter(Boolean).join(delimiter)

function run(file: string, args: string[], env: Record<string, string> = {}, timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = { env: { ...process.env, PATH: searchPath(), ...env }, timeout, maxBuffer: 32 * 1024 * 1024 }
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr).trim() || String(stdout).trim() || error.message))
      else resolve(String(stdout))
    })
  })
}

/** Feeds input to a command. Waits for its exit, not its pipes: wl-copy and xclip leave a child holding them. */
function pipeTo(file: string, args: string[], input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: { ...process.env, PATH: searchPath() }, stdio: ['pipe', 'ignore', 'ignore'] })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} exited with ${code}`))))
    child.stdin.on('error', reject)
    child.stdin.end(input)
  })
}

async function copyText(text: string): Promise<ActionResult> {
  for (const [file, ...args] of CLIPBOARD[process.platform] ?? []) {
    try {
      await pipeTo(file, args, text)
      return { ok: true }
    } catch {
      // not installed, or no display to own the clipboard: try the next
    }
  }
  return { ok: false, error: 'no-clipboard' }
}

/** The orca CLI: the setting, else the one of the running Orca, else the first on PATH. */
function orcaCli(config: InboxConfig): string {
  if (config.orcaCli) return config.orcaCli
  const candidates = [
    process.env.ORCA_CLI_BIN_DIR && join(process.env.ORCA_CLI_BIN_DIR, 'orca'),
    ORCA_APP_CLI,
    ...searchPath().split(delimiter).map((dir) => join(dir, 'orca'))
  ]
  return candidates.find((path): path is string => Boolean(path) && existsSync(path as string)) ?? 'orca'
}

/** The message of the orca CLI's JSON error, else the text as it is. */
function orcaError(text: string): string {
  try {
    return JSON.parse(text).error?.message ?? text
  } catch {
    return text
  }
}

async function orcaJson(config: InboxConfig, ...args: string[]): Promise<Raw> {
  let out: Raw
  try {
    // an agent launch waits for the agent to start
    out = JSON.parse(await run(orcaCli(config), [...args, '--json'], {}, args[0] === 'agent' ? 60_000 : 20_000))
  } catch (e) {
    throw new Error(orcaError(errorText(e)))
  }
  if (!out.ok) throw new Error(out.error?.message ?? `orca ${args.join(' ')} failed`)
  return out.result
}

let teardown: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi): void {
  const home = homedir()
  let config = readConfig({}, home)
  let setup: Setup = { cli: join(configDir(home), 'bin', 'agent-inbox'), guide: join(configDir(home), 'agent-guide.md'), log: config.logPath }
  let setupError: string | null = null
  let watcher: FSWatcher | null = null
  let logTimer: ReturnType<typeof setTimeout> | undefined

  const panelsChanged = () => orca.panels.post('inbox.changed', { at: Date.now() })

  const setupPending = async () => (await orca.storage.get(SETUP_DONE)) === false

  /** Watches the log's folder for the log and the points, which sit beside it. */
  function watchLog(): void {
    watcher?.close()
    watcher = null
    const names = new Set([basename(config.logPath), basename(pointsPath(config.logPath))])
    try {
      watcher = watch(dirname(config.logPath), (_event, changed) => {
        if (changed === null || !names.has(String(changed))) return
        clearTimeout(logTimer)
        logTimer = setTimeout(panelsChanged, 500)
      })
      watcher.unref()
    } catch (e) {
      orca.log(`cannot watch ${config.logPath}: ${errorText(e)}`)
    }
  }

  function pruneNow(): void {
    try {
      const removed = prune(config)
      if (removed > 0) orca.log(`pruned ${removed} log lines older than ${config.retentionDays} days`)
    } catch (e) {
      orca.log(`prune ${config.logPath}: ${errorText(e)}`)
    }
  }

  async function load(): Promise<void> {
    config = readConfig(await orca.settings.get(), home)
    try {
      setup = install(config, home, ROOT)
      setupError = null
    } catch (e) {
      setup = { ...setup, log: config.logPath }
      setupError = `install into ${configDir(home)}: ${errorText(e)}`
      orca.log(setupError)
    }
    // only the first start decides: someone with a log already sends to Agent Inbox
    if (typeof (await orca.storage.get(SETUP_DONE)) !== 'boolean') {
      await orca.storage.set(SETUP_DONE, readEntries(config.logPath).length > 0)
    }
    pruneNow()
    watchLog()
  }

  const ready = load()

  async function storedIds(key: string): Promise<string[]> {
    const value = await orca.storage.get(key)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  }
  const readIds = async () => new Set([...(await storedIds(READ)), ...(await storedIds(DISMISSED))])

  async function list(): Promise<Inbox> {
    await ready
    const entries = readEntries(config.logPath)
    const read = await readIds()
    const messages = recentMessages(entries, Date.now(), config.retentionDays).map((e) => ({
      id: messageId(e),
      at: e.at,
      key: e.key,
      text: e.message,
      url: e.url,
      read: read.has(messageId(e))
    }))
    const base = {
      messages,
      points: readPoints(config.logPath),
      retentionDays: config.retentionDays,
      language: config.language,
      setup,
      setupPending: await setupPending()
    }
    try {
      const [ps, terms] = await Promise.all([
        orcaJson(config, 'worktree', 'ps', '--limit', '1000'),
        orcaJson(config, 'terminal', 'list', '--limit', '1000')
      ])
      const waiting = waitingItems(ps.worktrees ?? [], terms.terminals ?? [], openAsks(entries), config.waitingStatus)
      return { ...base, waiting, error: setupError }
    } catch (e) {
      return { ...base, waiting: [], error: [setupError, `orca: ${errorText(e)}`].filter(Boolean).join('\n') }
    }
  }

  async function open(input: { path: string; terminal: string | null }): Promise<ActionResult> {
    await ready
    if (!input.terminal) return { ok: false, error: 'no-terminal' }
    try {
      await orcaJson(config, 'terminal', 'switch', '--terminal', input.terminal)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  }

  async function resolve(input: { path: string; key: string }): Promise<ActionResult> {
    await ready
    try {
      // the settings as this worker has them, whether or not config.env is written yet
      await run('/bin/bash', [CLI, 'resolve', '--worktree', input.path, input.key], {
        AGENT_INBOX_LOG: config.logPath,
        AGENT_INBOX_WAITING: config.waitingStatus,
        AGENT_INBOX_RESUME: config.resumeStatus,
        AGENT_INBOX_ORCA: orcaCli(config)
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    } finally {
      panelsChanged()
    }
  }

  orca.panels.handle('inbox.list', () => list())
  orca.panels.handle('inbox.open', (input) => open(input))
  orca.panels.handle('inbox.resolve', (input) => resolve(input))
  orca.panels.handle('inbox.read', async ({ ids }) => {
    await ready
    // keep only ids still inside the retention window, so the list does not grow forever
    const live = new Set(recentMessages(readEntries(config.logPath), Date.now(), config.retentionDays).map(messageId))
    const read = new Set([...(await readIds()), ...ids])
    await orca.storage.set(READ, [...read].filter((id) => live.has(id)))
    await orca.storage.delete(DISMISSED)
    return { ok: true }
  })

  orca.panels.handle('inbox.setupDone', async () => {
    await ready
    await orca.storage.set(SETUP_DONE, true)
    return { ok: true }
  })
  orca.panels.handle('inbox.copy', ({ text }) => copyText(String(text)))

  orca.panels.handle('inbox.launch', async ({ prompt }) => {
    await ready
    try {
      const ps = await orcaJson(config, 'worktree', 'ps', '--limit', '1000')
      const workspace = activeWorkspace(ps.worktrees ?? [])
      if (workspace === null) return { ok: false, error: 'no-workspace' }
      const query = (db: string, sql: string) => run('sqlite3', ['-readonly', db, sql])
      const agent = await defaultAgent(activeProfileDir(orcaDataDir(home, process.platform, process.env)), query)
      await orcaJson(config, 'agent', 'launch', '--agent', agent, '--worktree', `path:${workspace}`, '--prompt', String(prompt), '--focus')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  })

  const subscription = orca.settings.onDidChange(() => {
    void load().then(panelsChanged)
  })
  // Orca's channel keeps the worker process alive; the timer and the watcher must not on their own
  const pruneTimer = setInterval(pruneNow, PRUNE_MS)
  pruneTimer.unref()

  teardown = () => {
    clearInterval(pruneTimer)
    clearTimeout(logTimer)
    watcher?.close()
    subscription.dispose()
  }
}

export function deactivate(): void {
  teardown?.()
  teardown = null
}
