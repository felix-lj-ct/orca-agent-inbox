// agent-inbox: how an agent or a script tells the person at the Orca window something. The Agent Inbox
// plugin shows it in its sidebar panel. The plugin installs this file as ~/.config/agent-inbox/lib/agent-inbox.mjs,
// with launchers in ~/.config/agent-inbox/bin that run it on Orca's own runtime (agent-inbox, and agent-inbox.cmd
// on Windows) and config.json beside them, and rewrites them whenever Orca starts it or its settings change:
// edit none of them.
//
// <key> names the work (a ticket, a job, a workspace). --worktree defaults to the Git top level of the
// current directory. Settings: the environment (AGENT_INBOX_LOG, AGENT_INBOX_WAITING, AGENT_INBOX_RESUME,
// AGENT_INBOX_ORCA), then ~/.config/agent-inbox/config.json, then the defaults below. The points are kept
// beside the log: inbox.jsonl keeps them in inbox.points.jsonl.
// In WSL, bin/agent-inbox runs this on Windows too, on Orca's runtime, and passes on the directory it was run in
// (AGENT_INBOX_WSL_CWD) and its Git top level (AGENT_INBOX_WSL_TOP). Workspaces are then Linux paths, which the
// orca CLI resolves in the distro of the directory that ORCA_CLI_CWD gives it in Windows form, the way Orca's own
// orca command in WSL does.
// Exit codes: 0 done, 2 usage, 3 the orca CLI is missing or failed, 4 the log stayed locked.
import { execFileSync } from 'node:child_process'
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, posix, resolve } from 'node:path'

const USAGE = `  agent-inbox notify <key> <message> [<url>]
      a line in the panel's Messages: something happened, nothing waits on the person
  agent-inbox ask [--worktree <path>] <key> <message> [<url>]
      you stop until the person answers: the workspace moves to the waiting column with
      "<key>: <message>" as its comment and the unread dot, and the panel lists it under Waiting on you
  agent-inbox resolve [--worktree <path>] <key>
      the person answered: the workspace moves back to the resolved column, if it is still waiting
  agent-inbox test [--worktree <path>]
      drill: an ask for the key TEST; undo it with \`agent-inbox resolve TEST\`
  agent-inbox point add <id> <ask|notify> <key> <when> <wired-in>
      record a point of the workflow that sends, for the panel's Wired points: <id> names the point
      (letters, digits, . _ -), <key> is the key it sends (a placeholder such as <ticket> when it
      varies), <when> says when it sends, <wired-in> where it is wired. The same id again replaces it
  agent-inbox point remove <id>
      the point no longer sends
  agent-inbox point list
      the recorded points, one JSON object per line
  agent-inbox hook
      for an agent's session-start hook (Claude Code: SessionStart): print what the agent needs to know
      to send here, and that it judges what is worth sending; nothing outside an Orca terminal
  agent-inbox where
      print the settings in use
`

// What an agent reads at the start of each session, through its session-start hook. It says what the inbox is
// and how to send, and leaves what to send to the agent.
const BRIEF = `Agent Inbox is on: Orca shows the person a panel of what waits on them and of the messages sent to it. They may not be watching this terminal. Send to it what matters to them; you judge what does.
- Before you stop for their decision, approval or help, run
    ~/.config/agent-inbox/bin/agent-inbox ask <key> "<what you need, one line>"
  and once they answer and you go on, run
    ~/.config/agent-inbox/bin/agent-inbox resolve <key>
- For something they should know and would not see otherwise, run
    ~/.config/agent-inbox/bin/agent-inbox notify <key> "<what happened; what to do, one line>" [<url>]
<key> names the work, such as a ticket id or a branch. Orca already shows when you finish a turn. The log is a plain text file: send no secrets.
`

const WINDOWS = process.platform === 'win32'
/** Set when run from WSL: the Linux directory it was run in. */
const WSL_CWD = process.env.AGENT_INBOX_WSL_CWD
const HOME = homedir()
const CONFIG = join(HOME, '.config', 'agent-inbox', 'config.json')

/** Ends the run with an exit code: thrown, so the lock is released and the output is flushed on the way out. */
class Exit extends Error {
  constructor(code, text) {
    super(text)
    this.code = code
    this.text = text
  }
}
const die = (code, message) => {
  throw new Exit(code, `agent-inbox: ${message}\n`)
}
const usage = () => {
  throw new Exit(2, USAGE)
}

function readConfigFile() {
  try {
    const value = JSON.parse(readFileSync(CONFIG, 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}
const file = readConfigFile()
const setting = (env, key, fallback) => process.env[env] || (typeof file[key] === 'string' && file[key]) || fallback

const expandHome = (path) => (path === '~' ? HOME : /^~[\\/]/.test(path) ? join(HOME, path.slice(2)) : path)
const LOG = expandHome(setting('AGENT_INBOX_LOG', 'log', join(HOME, '.local', 'state', 'agent-inbox', 'inbox.jsonl')))
const WAITING = setting('AGENT_INBOX_WAITING', 'waiting', 'in-review')
const RESUME = setting('AGENT_INBOX_RESUME', 'resume', 'in-progress')
const POINTS = `${LOG.replace(/\.jsonl$/, '')}.points.jsonl`

const runnable = (path) => {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}
// Node runs only executables directly: on Windows, orca.exe rather than the orca.cmd beside it.
const executable = (path) => (WINDOWS ? path.replace(/\.(cmd|bat)$/i, '.exe') : path)

/** The orca CLI: the setting, else the one of this terminal's Orca, else of the Orca whose runtime runs this, else on PATH. */
function findOrca() {
  const set = process.env.AGENT_INBOX_ORCA || (typeof file.orca === 'string' && file.orca)
  if (set) return executable(expandHome(set))
  const name = WINDOWS ? 'orca.exe' : 'orca'
  const runtimeDir = dirname(process.execPath)
  const candidates = [
    process.env.ORCA_CLI_BIN_DIR && join(process.env.ORCA_CLI_BIN_DIR, name),
    WINDOWS && join(runtimeDir, 'resources', 'bin', name),
    process.platform === 'darwin' && join(runtimeDir, '..', 'Resources', 'bin', name),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, name)),
    process.platform === 'darwin' && '/Applications/Orca.app/Contents/Resources/bin/orca'
  ]
  return candidates.find((path) => path && runnable(path)) || null
}

/** The result the orca CLI answers with; {} when it says nothing this can read. */
function orcaCli(...args) {
  const orca = findOrca() ?? die(3, 'orca CLI not found: set "orca command" in the Agent Inbox settings, or AGENT_INBOX_ORCA')
  let out
  try {
    out = execFileSync(orca, [...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message
    return die(3, `orca ${args[0]} ${args[1]} failed (is Orca running?): ${text}`)
  }
  try {
    return JSON.parse(out).result ?? {}
  } catch {
    return {}
  }
}

// Control characters other than tab, newline and return are dropped; JSON.stringify escapes the rest.
const clean = (text) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
const orNull = (text) => (text ? clean(text) : null)
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** Replaces a file; on Windows a reader such as a virus scanner can hold it for a moment. */
function replace(from, to) {
  for (let tries = 0; ; tries++) {
    try {
      return renameSync(from, to)
    } catch (e) {
      if (tries >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e
      sleep(50)
    }
  }
}

// The plugin prunes the log under the same lock, so a line appended meanwhile is never lost.
const LOCK = `${LOG}.lock`
function withLock(fn) {
  for (let tries = 0; ; ) {
    try {
      mkdirSync(LOCK)
      break
    } catch {
      tries += 1
      // nothing holds the lock for more than a moment: after ~5 s it was left by a killed process
      if (tries === 50) rmSync(LOCK, { recursive: true, force: true })
      if (tries > 60) die(4, `${LOCK} stayed locked; remove it if no agent-inbox or Orca is running`)
      sleep(100)
    }
  }
  try {
    return fn()
  } finally {
    try {
      rmdirSync(LOCK)
    } catch {
      // someone broke it as stale
    }
  }
}

function append(kind, key, message, url, worktree) {
  const line = JSON.stringify({
    v: 1,
    ts: now(),
    kind,
    key: clean(key),
    message: clean(message),
    url: orNull(url),
    worktree: orNull(worktree),
    terminal: orNull(process.env.ORCA_TERMINAL_HANDLE ?? '')
  })
  mkdirSync(dirname(LOG), { recursive: true })
  withLock(() => appendFileSync(LOG, `${line}\n`))
}

// Ids are letters, digits and . _ -, so the line prefix names the point exactly.
const pointPrefix = (id) => `{"v":1,"id":"${id}",`
const pointLines = () => (existsSync(POINTS) ? readFileSync(POINTS, 'utf8').split('\n').filter(Boolean) : [])

/** Rewrites the points without the one named id, then adds line if given. Under the log's lock, so two writers never mix. */
function putPoint(id, line) {
  mkdirSync(dirname(POINTS), { recursive: true })
  withLock(() => {
    const kept = pointLines().filter((l) => !l.startsWith(pointPrefix(id)))
    if (line) kept.push(line)
    const tmp = `${POINTS}.tmp-${process.pid}`
    writeFileSync(tmp, kept.map((l) => `${l}\n`).join(''))
    replace(tmp, POINTS)
  })
}
function pointId(id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id ?? '')) die(2, `point id must be letters, digits, . _ or -: '${id ?? ''}'`)
}
const hasPoint = (id) => pointLines().some((l) => l.startsWith(pointPrefix(id)))

function gitTop() {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    return out.trim()
  } catch {
    return ''
  }
}

/**
 * A workspace path the way Orca writes it: absolute and, on Windows, with backslashes and an upper-case drive.
 * Git reports C:/a/b there, and Git Bash passes /c/a/b.
 */
function nativePath(path) {
  if (!path) return ''
  if (!WINDOWS) return resolve(path)
  return resolve(path.replace(/^\/([A-Za-z])(?=\/|$)/, '$1:')).replace(/^[a-z]:/, (drive) => drive.toUpperCase())
}

/** The workspace: the one passed, else the Git top level of the current directory; '' outside one. */
function workspacePath(wt) {
  if (WSL_CWD) return wt ? posix.resolve(WSL_CWD, wt) : (process.env.AGENT_INBOX_WSL_TOP ?? '')
  return nativePath(wt || gitTop())
}

/** The workspace's path as Orca has it, which the panel finds it by; from WSL, its Windows path. */
const orcaPath = (worktree, path) => (typeof worktree?.path === 'string' && worktree.path) || path

function main(argv) {
  if (argv.length < 1) usage()
  const cmd = argv.shift()
  let wt = ''
  if (argv[0] === '--worktree') {
    if (argv.length < 2) usage()
    wt = argv[1]
    argv.splice(0, 2)
  }
  const workspace = () => workspacePath(wt) || die(2, 'no workspace: run inside it or pass --worktree <path>')
  const out = (text) => process.stdout.write(text)

  switch (cmd) {
    case 'notify': {
      const [key, message, url = ''] = argv
      if (argv.length < 2 || !message) usage()
      append('notify', key, message, url, workspacePath(wt))
      return out(`notify ${key}: ${message}\n`)
    }
    case 'ask':
    case 'test': {
      if (cmd === 'test') argv = ['TEST', 'Drill from agent-inbox test; undo it with: agent-inbox resolve TEST']
      const [key, message, url = ''] = argv
      if (argv.length < 2 || !message) usage()
      const path = workspace()
      const set = orcaCli('worktree', 'set', '--worktree', `path:${path}`, '--workspace-status', WAITING, '--comment', `${key}: ${message}`, '--unread')
      append('ask', key, message, url, orcaPath(set.worktree, path))
      return out(`ask ${key}: ${message}\n`)
    }
    case 'resolve': {
      if (argv.length < 1) usage()
      const path = workspace()
      const shown = orcaCli('worktree', 'show', '--worktree', `path:${path}`).worktree
      // leave a workspace the person already moved on alone
      if (shown?.workspaceStatus === WAITING) {
        orcaCli('worktree', 'set', '--worktree', `path:${path}`, '--workspace-status', RESUME, '--comment', '')
      }
      append('resolve', argv[0], '', '', orcaPath(shown, path))
      return out(`resolve ${argv[0]}\n`)
    }
    case 'point': {
      const [sub, id, kind, key, when, wiredIn] = argv
      if (sub === 'add') {
        if (argv.length !== 6 || !key || !when || !wiredIn) usage()
        pointId(id)
        if (kind !== 'ask' && kind !== 'notify') die(2, `point kind must be ask or notify: '${kind}'`)
        putPoint(id, JSON.stringify({ v: 1, id, kind, key: clean(key), when: clean(when), wiredIn: clean(wiredIn), ts: now() }))
        return out(`point ${id}: ${kind} when ${when}\n`)
      }
      if (sub === 'remove') {
        if (argv.length !== 2) usage()
        pointId(id)
        if (!hasPoint(id)) return out(`no point ${id}\n`)
        putPoint(id)
        return out(`point ${id} removed\n`)
      }
      if (sub === 'list') {
        if (argv.length !== 1) usage()
        return out(existsSync(POINTS) ? readFileSync(POINTS, 'utf8') : '')
      }
      return usage()
    }
    case 'hook':
      // The agent passes the session on stdin; the brief needs none of it. Outside an Orca terminal the panel
      // cannot take the person to the agent, so the agent hears nothing.
      return process.env.ORCA_TERMINAL_HANDLE ? out(BRIEF) : undefined
    case 'where':
      return out(
        `log      ${LOG}\npoints   ${POINTS}\nwaiting  ${WAITING}\nresolved ${RESUME}\norca     ${findOrca() ?? 'not found'}\nconfig   ${CONFIG}\n`
      )
    default:
      return usage()
  }
}

try {
  main(process.argv.slice(2))
} catch (e) {
  // no process.exit: on Windows it can cut off output still on its way down a pipe
  process.stderr.write(e instanceof Exit ? e.text : `agent-inbox: ${e instanceof Error ? e.message : e}\n`)
  process.exitCode = e instanceof Exit ? e.code : 1
}
