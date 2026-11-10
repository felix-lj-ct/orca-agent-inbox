// Agent Inbox's worker. On start and on every settings change it installs the CLI, config.json and the
// guides of guide/ into ~/.config/agent-inbox and prunes the log to the retention window, then prunes again
// every hour. It answers the panel from the log and the Orca board, which it reads through the orca CLI
// (the host API has no board), keeps asks until the person marks them handled when the settings say so, lists
// the points recorded beside the log, starts the agent that adds, removes
// or aligns them, stars the repository through gh when the person asks, and tells open panels when the log or the
// points change. On Windows it also links ~/.config/agent-inbox in the WSL distros of the board's workspaces
// (src/wsl.ts). Orca starts it for a panel request and stops it when idle.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { existsSync, type FSWatcher, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitingItems } from './board'
import { configDir, type InboxConfig, readConfig } from './config'
import { activeProfileDir, activeWorkspace, defaultAgent, orcaDataDir, sqliteValue } from './launch'
import { currentId, heldAsks, type Hold, messageId, openAsks, pathKey, recentMessages } from './log'
import { pointsPath } from './points'
import { type ActionResult, type Inbox, type InboxMessage, MESSAGE_PAGE, REPO, type Setup } from './protocol'
import { cliPath, install, prune, readEntries, readPoints } from './store'
import { distroNames, linkArgs, WSL_EXE, wslDistros } from './wsl'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'cli', 'agent-inbox.mjs')
const PRUNE_MS = 3600_000
/** A WSL distro that was not running is looked at again after this long. */
const WSL_RETRY_MS = 300_000
/** A request answer stops at 1 MiB: the messages get half of it, the board and the points share the rest. */
const MESSAGE_BYTES = 512 * 1024
/** The panel gets this much of a message's text and key; the log keeps them whole. */
const MAX_TEXT = 2_000
const MAX_KEY = 200
/** A longer link is left out, since a cut one would not open. */
const MAX_URL = 8_192
/** Ids of the read messages inside the retention window. */
const READ = 'read'
/** Before read and unread, hidden messages; they count as read. */
const DISMISSED = 'dismissed'
/** false while the setup task waits, true once handled; unset until the first start decides. */
const SETUP_DONE = 'setupDone'
/** With asks kept until handled: when the setting went on, and the asks marked handled (see Hold). */
const HOLD_SINCE = 'holdSince'
const HANDLED = 'handled'
const WINDOWS = process.platform === 'win32'
const ORCA_APP_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'
/** orca CLI JSON, read field by field */
type Raw = any

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The text cut to max characters and an ellipsis, never between the two halves of a surrogate pair. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut}…`
}

/** How many messages of a tab the panel asked for; the first page when it did not say. */
const pageSize = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : MESSAGE_PAGE)

/** The first messages that fit in bytes together, as JSON. */
function fitting(messages: InboxMessage[], bytes: number): InboxMessage[] {
  let used = 0
  for (let i = 0; i < messages.length; i++) {
    used += Buffer.byteLength(JSON.stringify(messages[i]))
    if (used > bytes) return messages.slice(0, i)
  }
  return messages
}

// The worker does not get a login shell's PATH. On Windows it gets the one Orca has.
const searchPath = () =>
  (WINDOWS ? [process.env.PATH] : [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin']).filter(Boolean).join(delimiter)

/**
 * The environment of the commands the worker starts. Orca passes its workers no APPDATA or LOCALAPPDATA, which on
 * Windows the orca CLI needs to find the running Orca and gh its sign-in: they come from the home folder, the way
 * Orca finds them when Windows does not say.
 */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const folders = WINDOWS
    ? { APPDATA: process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), LOCALAPPDATA: process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local') }
    : {}
  return { ...process.env, PATH: searchPath(), ...folders, ...extra }
}

// windowsHide: a console program started from Orca would open a console window of its own
function run(file: string, args: string[], env: Record<string, string> = {}, timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = { env: childEnv(env), timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr).trim() || String(stdout).trim() || error.message))
      else resolve(String(stdout))
    })
  })
}

// Node runs only executables directly: on Windows, orca.exe rather than the orca.cmd beside it.
const executable = (path: string) => (WINDOWS ? path.replace(/\.(cmd|bat)$/i, '.exe') : path)

/**
 * The orca CLI: the setting, else the one of the running Orca (this worker runs on its runtime), else the first
 * on PATH.
 */
function orcaCli(config: InboxConfig): string {
  if (config.orcaCli) return executable(config.orcaCli)
  const name = WINDOWS ? 'orca.exe' : 'orca'
  const runtimeDir = dirname(process.execPath)
  const candidates = [
    process.env.ORCA_CLI_BIN_DIR && join(process.env.ORCA_CLI_BIN_DIR, name),
    WINDOWS && join(runtimeDir, 'resources', 'bin', name),
    process.platform === 'darwin' && join(runtimeDir, '..', 'Resources', 'bin', name),
    ORCA_APP_CLI,
    ...searchPath().split(delimiter).map((dir) => join(dir, name))
  ]
  return candidates.find((path): path is string => typeof path === 'string' && existsSync(path)) ?? name
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
  let setup: Setup = { cli: cliPath(home), guide: join(configDir(home), 'agent-guide.md'), log: config.logPath }
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

  /** The asks kept until handled; null while the setting is off. */
  async function hold(): Promise<Hold | null> {
    if (!config.keepAsksUntilHandled) return null
    const since = await orca.storage.get(HOLD_SINCE)
    const handled = await orca.storage.get(HANDLED)
    return {
      since: typeof since === 'number' ? since : Date.now(),
      handled: typeof handled === 'object' && handled !== null && !Array.isArray(handled) ? (handled as Record<string, string>) : {}
    }
  }

  async function pruneNow(): Promise<void> {
    try {
      const removed = prune(config, Date.now(), (await hold()) ?? undefined)
      if (removed > 0) orca.log(`pruned ${removed} log lines older than ${config.retentionDays} days`)
    } catch (e) {
      orca.log(`prune ${config.logPath}: ${errorText(e)}`)
    }
  }

  /** Per WSL distro (in lower case): true once linked, else when it was last looked at. */
  const wslLinks = new Map<string, true | number>()

  /** Links ~/.config/agent-inbox in the running WSL distros of these workspaces, once each (see src/wsl.ts). */
  async function linkWsl(worktrees: Raw[]): Promise<void> {
    const due = wslDistros(worktrees).filter((distro) => {
      const state = wslLinks.get(distro.toLowerCase())
      return state === undefined || (state !== true && Date.now() - state > WSL_RETRY_MS)
    })
    if (due.length === 0) return
    for (const distro of due) wslLinks.set(distro.toLowerCase(), Date.now())
    let running: string[] = []
    try {
      running = distroNames(await run(WSL_EXE, ['--list', '--running', '--quiet'], { WSL_UTF8: '1' })).map((d) => d.toLowerCase())
    } catch {
      // wsl.exe fails when no distro runs
    }
    for (const distro of due.filter((d) => running.includes(d.toLowerCase()))) {
      wslLinks.set(distro.toLowerCase(), true)
      try {
        const said = (await run(WSL_EXE, linkArgs(distro, configDir(home)))).trim()
        if (said) orca.log(`WSL ${distro}: ${said}`)
      } catch (e) {
        orca.log(`link ~/.config/agent-inbox in WSL ${distro}: ${errorText(e)}`)
      }
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
    // asks handled before the setting went on stay handled; off, nothing is kept for the next time it goes on
    if (!config.keepAsksUntilHandled) {
      await orca.storage.delete(HOLD_SINCE)
      await orca.storage.delete(HANDLED)
    } else if (typeof (await orca.storage.get(HOLD_SINCE)) !== 'number') {
      // to the second, as the log has it: a resolve in the same second counts as after
      await orca.storage.set(HOLD_SINCE, Math.floor(Date.now() / 1000) * 1000)
    }
    await pruneNow()
    watchLog()
  }

  const ready = load()

  async function storedIds(key: string): Promise<string[]> {
    const value = await orca.storage.get(key)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map(currentId) : []
  }
  const readIds = async () => new Set([...(await storedIds(READ)), ...(await storedIds(DISMISSED))])

  async function list(limits: { unread?: unknown; read?: unknown }): Promise<Inbox> {
    await ready
    const entries = readEntries(config.logPath)
    const read = await readIds()
    const messages = recentMessages(entries, Date.now(), config.retentionDays).map((e): InboxMessage => {
      const id = messageId(e)
      const url = e.url !== null && e.url.length <= MAX_URL ? e.url : null
      return { id, at: e.at, key: clip(e.key, MAX_KEY), text: clip(e.message, MAX_TEXT), url, read: read.has(id) }
    })
    const unread = messages.filter((m) => !m.read)
    const history = messages.filter((m) => m.read)
    const base = {
      messages: fitting([...unread.slice(0, pageSize(limits.unread)), ...history.slice(0, pageSize(limits.read))], MESSAGE_BYTES),
      unreadCount: unread.length,
      readCount: history.length,
      points: readPoints(config.logPath),
      retentionDays: config.retentionDays,
      keepMessagesUntilRead: config.keepMessagesUntilRead,
      language: config.language,
      setup,
      setupPending: await setupPending()
    }
    try {
      const [ps, terms] = await Promise.all([
        orcaJson(config, 'worktree', 'ps', '--limit', '1000'),
        orcaJson(config, 'terminal', 'list', '--limit', '1000')
      ])
      const kept = await hold()
      const held = kept === null ? undefined : heldAsks(entries, kept)
      const waiting = waitingItems(ps.worktrees ?? [], terms.terminals ?? [], openAsks(entries), config.waitingStatus, held)
      if (WINDOWS) void linkWsl(ps.worktrees ?? [])
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
      // on Orca's runtime, which runs this worker; with the settings as this worker has them, whether or not
      // config.json is written yet
      await run(process.execPath, [CLI, 'resolve', '--worktree', input.path, input.key], {
        ELECTRON_RUN_AS_NODE: '1',
        AGENT_INBOX_LOG: config.logPath,
        AGENT_INBOX_WAITING: config.waitingStatus,
        AGENT_INBOX_RESUME: config.resumeStatus,
        AGENT_INBOX_ORCA: orcaCli(config)
      })
      await markHandled(input.path)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    } finally {
      panelsChanged()
    }
  }

  /**
   * With asks kept until handled: the last ask of the workspace is handled. Only workspaces with an ask still in
   * the log stay recorded, so the record does not grow forever.
   */
  async function markHandled(path: string): Promise<void> {
    const kept = await hold()
    if (kept === null) return
    const last = new Map<string, string>()
    for (const e of readEntries(config.logPath)) if (e.kind === 'ask' && e.worktree) last.set(pathKey(e.worktree), messageId(e))
    const handled: Record<string, string> = {}
    for (const [p, id] of Object.entries(kept.handled)) if (last.has(p)) handled[p] = id
    const id = last.get(pathKey(path))
    if (id !== undefined) handled[pathKey(path)] = id
    await orca.storage.set(HANDLED, handled)
  }

  /** Adds ids to the read ones; only ids still inside the retention window stay, so the list does not grow forever. */
  async function markRead(ids: string[]): Promise<ActionResult> {
    await ready
    const live = new Set(recentMessages(readEntries(config.logPath), Date.now(), config.retentionDays).map(messageId))
    const read = new Set([...(await readIds()), ...ids])
    await orca.storage.set(READ, [...read].filter((id) => live.has(id)))
    await orca.storage.delete(DISMISSED)
    return { ok: true }
  }

  orca.panels.handle('inbox.list', (input) => list(input ?? {}))
  orca.panels.handle('inbox.open', (input) => open(input))
  orca.panels.handle('inbox.resolve', (input) => resolve(input))
  orca.panels.handle('inbox.read', ({ ids }) => markRead(ids))
  orca.panels.handle('inbox.readAll', async ({ through }) => {
    await ready
    const shown = recentMessages(readEntries(config.logPath), Date.now(), config.retentionDays).filter((e) => e.at <= through)
    return markRead(shown.map(messageId))
  })

  orca.panels.handle('inbox.setupDone', async () => {
    await ready
    await orca.storage.set(SETUP_DONE, true)
    return { ok: true }
  })

  orca.panels.handle('inbox.launch', async ({ prompt }) => {
    await ready
    try {
      const ps = await orcaJson(config, 'worktree', 'ps', '--limit', '1000')
      const workspace = activeWorkspace(ps.worktrees ?? [])
      if (workspace === null) return { ok: false, error: 'no-workspace' }
      const query = async (db: string, sql: string) => (await sqliteValue(db, sql)) ?? run('sqlite3', ['-readonly', db, sql])
      const agent = await defaultAgent(activeProfileDir(orcaDataDir(home, process.platform, process.env)), query)
      await orcaJson(config, 'agent', 'launch', '--agent', agent, '--worktree', `path:${workspace}`, '--prompt', String(prompt), '--focus')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  })

  // only when the person presses Star: the plugin's one request to the network, with their own gh sign-in
  orca.panels.handle('inbox.star', async () => {
    try {
      await run('gh', ['api', '--method', 'PUT', `/user/starred/${REPO}`])
      return { ok: true }
    } catch (e) {
      orca.log(`star ${REPO}: ${errorText(e)}`)
      return { ok: false, error: errorText(e) }
    }
  })

  const subscription = orca.settings.onDidChange(() => {
    void load().then(panelsChanged)
  })
  // Orca's channel keeps the worker process alive; the timer and the watcher must not on their own
  const pruneTimer = setInterval(() => void pruneNow(), PRUNE_MS)
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
