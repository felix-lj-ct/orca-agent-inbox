// Agent Inbox's worker. On start and on every settings change it installs the CLI, config.env and the
// agent guide into ~/.config/agent-inbox and prunes the log to the retention window, then prunes again
// every hour. It answers the panel from the log and the Orca board, which it reads through the orca CLI
// (the host API has no board), keeps the status bar count, and tells open panels when the log changes.
// Its status bar item keeps it running for as long as the plugin is enabled.
import type { OrcaWorkerApi } from 'orca/worker'
import { execFile } from 'node:child_process'
import { existsSync, type FSWatcher, watch } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { waitingItems } from './board'
import { configDir, type InboxConfig, readConfig } from './config'
import { messageId, openAsks, recentMessages } from './log'
import type { ActionResult, Inbox, Setup } from './protocol'
import { install, prune, readEntries } from './store'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'cli', 'agent-inbox.sh')
const PRUNE_MS = 3600_000
/** A card dragged on the board by hand sends no event. */
const STATUS_POLL_MS = 60_000
const DISMISSED = 'dismissed'
const ORCA_APP_CLI = '/Applications/Orca.app/Contents/Resources/bin/orca'
/** orca CLI JSON, read field by field */
type Raw = any

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// The worker does not get a login shell's PATH.
const searchPath = () => [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].filter(Boolean).join(delimiter)

function run(file: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = { env: { ...process.env, PATH: searchPath(), ...env }, timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr).trim() || String(stdout).trim() || error.message))
      else resolve(String(stdout))
    })
  })
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
    out = JSON.parse(await run(orcaCli(config), [...args, '--json']))
  } catch (e) {
    throw new Error(orcaError(errorText(e)))
  }
  if (!out.ok) throw new Error(out.error?.message ?? `orca ${args.join(' ')} failed`)
  return out.result
}

function statusTooltip(config: InboxConfig, count: number): string {
  const zh = config.language === 'zh-CN' || (config.language === 'auto' && Intl.DateTimeFormat().resolvedOptions().locale.startsWith('zh'))
  return zh ? `Agent Inbox：${count} 个工作区在等你` : `Agent Inbox: ${count} waiting on you`
}

let teardown: (() => void) | null = null

export default function activate(orca: OrcaWorkerApi): void {
  const home = homedir()
  let config = readConfig({}, home)
  let setup: Setup = { cli: join(configDir(home), 'bin', 'agent-inbox'), guide: join(configDir(home), 'agent-guide.md'), log: config.logPath }
  let setupError: string | null = null
  let watcher: FSWatcher | null = null
  let lastCount: number | null = null
  let logTimer: ReturnType<typeof setTimeout> | undefined
  let statusTimer: ReturnType<typeof setTimeout> | undefined

  const panelsChanged = () => orca.panels.post('inbox.changed', { at: Date.now() })

  async function refreshStatus(): Promise<void> {
    let count = 0
    try {
      const ps = await orcaJson(config, 'worktree', 'ps', '--limit', '1000')
      count = (ps.worktrees ?? []).filter((w: Raw) => w.workspaceStatus === config.waitingStatus && !w.isArchived).length
    } catch {
      // Orca's runtime not up yet, or no orca CLI: the panel says which
    }
    if (count === lastCount) return
    lastCount = count
    try {
      await orca.host.call('statusBar.update', { id: 'waiting', text: String(count), visible: count > 0, tooltip: statusTooltip(config, count) })
    } catch (e) {
      orca.log(`status bar: ${errorText(e)}`)
    }
  }
  const refreshStatusSoon = () => {
    clearTimeout(statusTimer)
    statusTimer = setTimeout(() => void refreshStatus(), 1_000)
  }

  function watchLog(): void {
    watcher?.close()
    watcher = null
    const name = basename(config.logPath)
    try {
      watcher = watch(dirname(config.logPath), (_event, changed) => {
        if (changed !== name) return
        clearTimeout(logTimer)
        logTimer = setTimeout(() => {
          panelsChanged()
          void refreshStatus()
        }, 500)
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
    pruneNow()
    watchLog()
  }

  const ready = load()

  async function dismissedIds(): Promise<string[]> {
    const value = await orca.storage.get(DISMISSED)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  }

  async function list(): Promise<Inbox> {
    await ready
    const entries = readEntries(config.logPath)
    const dismissed = new Set(await dismissedIds())
    const messages = recentMessages(entries, Date.now(), config.retentionDays, dismissed).map((e) => ({
      id: messageId(e),
      at: e.at,
      key: e.key,
      text: e.message,
      url: e.url
    }))
    const base = { messages, retentionDays: config.retentionDays, language: config.language, setup }
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
      refreshStatusSoon()
    }
  }

  orca.panels.handle('inbox.list', () => list())
  orca.panels.handle('inbox.open', (input) => open(input))
  orca.panels.handle('inbox.resolve', (input) => resolve(input))
  orca.panels.handle('inbox.dismiss', async ({ id }) => {
    await ready
    // keep only ids still inside the retention window, so the list does not grow forever
    const live = new Set(recentMessages(readEntries(config.logPath), Date.now(), config.retentionDays, new Set()).map(messageId))
    const ids = (await dismissedIds()).filter((d) => live.has(d))
    await orca.storage.set(DISMISSED, [...ids, id])
    return { ok: true }
  })

  const subscriptions = [
    orca.settings.onDidChange(() => {
      void load().then(() => {
        lastCount = null
        panelsChanged()
        void refreshStatus()
      })
    }),
    orca.events.on('agent.status.changed', refreshStatusSoon),
    orca.events.on('workspace.created', refreshStatusSoon),
    orca.events.on('workspace.removed', refreshStatusSoon)
  ]
  void ready.then(() => refreshStatus())
  // Orca's channel keeps the worker process alive; the timers and the watcher must not on their own
  const pruneTimer = setInterval(pruneNow, PRUNE_MS)
  const pollTimer = setInterval(() => void refreshStatus(), STATUS_POLL_MS)
  pruneTimer.unref()
  pollTimer.unref()

  teardown = () => {
    clearInterval(pruneTimer)
    clearInterval(pollTimer)
    clearTimeout(logTimer)
    clearTimeout(statusTimer)
    watcher?.close()
    for (const s of subscriptions) s.dispose()
  }
}

export function deactivate(): void {
  teardown?.()
  teardown = null
}
