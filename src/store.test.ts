// install and prune on a temporary home, and the real CLI (cli/agent-inbox.mjs) against a fake orca CLI.
import { assert, test } from 'orca/testing'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from './config'
import { fakeOrca } from './fake-orca'
import { parseLog } from './log'
import { cliPath, cmdLauncher, install, prune, readEntries, readPoints, shLauncher } from './store'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'cli', 'agent-inbox.mjs')
const DAY = 24 * 3600 * 1000
const WINDOWS = process.platform === 'win32'
/** sh and a stand-in wslpath; Windows runs the launcher in WSL itself in src/wsl.test.ts. */
const POSIX_ONLY = { skip: WINDOWS }

type Run = { code: number; stdout: string; stderr: string }
const ran = (resolve: (run: Run) => void) => (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) =>
  resolve({ code: error ? Number(error.code) : 0, stdout, stderr })

/** A home with a fake orca CLI that records its calls and reports the workspace in `status`. */
function sandbox(status = 'in-review') {
  // the real path: git reports the workspace without symlinks (macOS /var is /private/var) or Windows short names
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-inbox-')))
  const orca = fakeOrca(home)
  orca.answer('worktree show', { worktree: { workspaceStatus: status } })
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  // the CLI finds the workspace as the Git top level of the current directory
  execFileSync('git', ['init', '-q', workspace])
  const config = readConfig({ logPath: '~/state/inbox.jsonl' }, home)
  // what the person's environment holds about Agent Inbox and Orca stays out
  const base = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AGENT_INBOX_|ORCA_|NODE_OPTIONS$)/i.test(name)))
  const env = (extra: Record<string, string> = {}) => ({ ...base, HOME: home, USERPROFILE: home, NODE_OPTIONS: orca.nodeOptions, ...extra })
  /** The CLI as an agent in the workspace's terminal term_1 runs it, with extra in its environment. */
  const cliWith = (extra: Record<string, string>, ...args: string[]) =>
    new Promise<Run>((resolve) =>
      execFile(process.execPath, [CLI, ...args], { cwd: workspace, env: env({ AGENT_INBOX_ORCA: orca.command, ORCA_TERMINAL_HANDLE: 'term_1', ...extra }) }, ran(resolve))
    )
  const cli = (...args: string[]) => cliWith({}, ...args)
  /** The CLI with input on its stdin, as `agent-inbox notify <key> - <<'EOF'` runs it. */
  const cliInput = (input: string, ...args: string[]) =>
    new Promise<Run>((resolve) => {
      const child = execFile(process.execPath, [CLI, ...args], { cwd: workspace, env: env({ AGENT_INBOX_ORCA: orca.command, ORCA_TERMINAL_HANDLE: 'term_1' }) }, ran(resolve))
      child.stdin?.end(input)
    })
  /** The CLI as installed, through its launcher: agent-inbox.cmd on Windows, agent-inbox elsewhere. */
  const installed = (...args: string[]) =>
    new Promise<Run>((resolve) => {
      if (!WINDOWS) return execFile(cliPath(home), args, { cwd: workspace, env: env() }, ran(resolve))
      // the line as cmd gets it from PowerShell; /s keeps its quotes, also around a path with spaces
      const line = [cliPath(home), ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')
      execFile('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd: workspace, env: env(), windowsVerbatimArguments: true }, ran(resolve))
    })
  return { home, workspace, config, orca, calls: orca.calls, cli, cliWith, cliInput, installed, env }
}

test('install puts the CLI with its launchers, config.json, the guide and the CLI reference where agents find them', () => {
  const { home, config } = sandbox()
  const dir = join(home, '.config', 'agent-inbox')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.env'), "AGENT_INBOX_LOG='/old'\n")
  const setup = install(config, home, ROOT)
  assert.equal(setup.cli, join(dir, 'bin', WINDOWS ? 'agent-inbox.cmd' : 'agent-inbox'))
  assert.ok(existsSync(setup.cli))
  assert.equal(readFileSync(join(dir, 'lib', 'agent-inbox.mjs'), 'utf8'), readFileSync(CLI, 'utf8'))
  if (!WINDOWS) assert.equal(statSync(join(dir, 'bin', 'agent-inbox')).mode & 0o777, 0o755)
  assert.equal(existsSync(join(dir, 'bin', 'agent-inbox.cmd')), WINDOWS)
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).log, join(home, 'state', 'inbox.jsonl'))
  assert.equal(existsSync(join(dir, 'config.env')), false)
  assert.match(readFileSync(setup.guide, 'utf8'), /^---\nname: agent-inbox\n/)
  assert.match(readFileSync(join(dir, 'cli.md'), 'utf8'), /^# Agent Inbox CLI\n/)
  assert.ok(existsSync(dirname(config.logPath)))
})

test('the launchers run the CLI on the runtime that installed them, else on node', () => {
  const sh = shLauncher('/Applications/Orca.app/Contents/MacOS/Orca', "/Users/o'neil/.config/agent-inbox/lib/agent-inbox.mjs", 'darwin')
  assert.match(sh, /^#!\/bin\/sh\n/)
  assert.match(sh, /^rt='\/Applications\/Orca\.app\/Contents\/MacOS\/Orca'$/m)
  assert.match(sh, /^ELECTRON_RUN_AS_NODE=1 exec "\$rt" '\/Users\/o'\\''neil\/\.config\/agent-inbox\/lib\/agent-inbox\.mjs' "\$@"$/m)
  assert.doesNotMatch(sh, /MSYS2_ARG_CONV_EXCL/)

  // Git Bash on Windows: forward slashes, and the arguments as given
  const gitBash = shLauncher('C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\Orca.exe', 'C:\\Users\\me\\.config\\agent-inbox\\lib\\agent-inbox.mjs', 'win32')
  assert.match(gitBash, /^rt='C:\/Users\/me\/AppData\/Local\/Programs\/Orca\/Orca\.exe'$/m)
  assert.match(gitBash, /^export MSYS2_ARG_CONV_EXCL='\*'$/m)
  assert.match(gitBash, /exec "\$rt" 'C:\/Users\/me\/\.config\/agent-inbox\/lib\/agent-inbox\.mjs' "\$@"$/m)
  assert.doesNotMatch(sh, /WSL/)

  // WSL, through the link to this folder: the Windows runtime through interop, never WSL's node
  assert.match(gitBash, /^if \[ -n "\$\{WSL_DISTRO_NAME:-\}" \]; then$/m)
  assert.match(gitBash, /^  rt=\$\(wslpath -u 'C:\\Users\\me\\AppData\\Local\\Programs\\Orca\\Orca\.exe' 2>\/dev\/null\) && \[ -x "\$rt" \] \|\| \{ .*exit 3; \}$/m)
  assert.match(gitBash, /^  export ELECTRON_RUN_AS_NODE=1 AGENT_INBOX_WSL_CWD="\$PWD" AGENT_INBOX_WSL_TOP="\$top" ORCA_CLI_CWD="\$cwd" WSLENV='[^']*ORCA_TERMINAL_HANDLE\/w[^']*'$/m)
  // in a Windows folder: one started in a WSL folder gets a \\wsl.localhost\... path, which Node trips over
  assert.match(gitBash, /^  cd "\$\{rt%\/\*\}"\n  exec "\$rt" 'C:\/Users\/me\/\.config\/agent-inbox\/lib\/agent-inbox\.mjs' "\$@"\nfi\nif \[ ! -x "\$rt" \]/m)

  // cmd reads the file in the console's code page: no user name in it, only ASCII
  const cmd = cmdLauncher('C:\\Users\\张三\\AppData\\Local\\Programs\\Orca\\Orca.exe', 'C:\\Users\\张三')
  assert.ok(cmd.split('\r\n').length > 5 && !/[^\r]\n/.test(cmd), 'CRLF line ends')
  assert.match(cmd, /^[\x00-\x7f]*$/)
  assert.match(cmd, /^set "RT=%USERPROFILE%\\AppData\\Local\\Programs\\Orca\\Orca\.exe"\r$/m)
  assert.match(cmd, /^"%RT%" "%~dp0\.\.\\lib\\agent-inbox\.mjs" %\*\r$/m)
  assert.match(cmd, /^set NODE_OPTIONS=\r$/m)
  // elsewhere the runtime is written as it is, % doubled
  assert.match(cmdLauncher('D:\\100%\\Orca\\Orca.exe', 'C:\\Users\\me'), /^set "RT=D:\\100%%\\Orca\\Orca\.exe"\r$/m)
})

test('the installed CLI follows the settings in config.json, on Orca or on node', async () => {
  const { home, config, installed } = sandbox()
  install(config, home, ROOT)
  const where = await installed('where')
  assert.equal(where.code, 0, where.stderr)
  assert.match(where.stdout, /^log +(.*)$/m)
  assert.equal(/^log +(.*)$/m.exec(where.stdout)?.[1].trim(), config.logPath)
  assert.equal((await installed('notify', 'K-1', 'hello')).code, 0)
  assert.equal(readEntries(config.logPath)[0].message, 'hello')

  // an Orca that moved: the launcher falls back to node on PATH
  install(config, home, ROOT, join(home, 'gone', 'Orca'))
  assert.equal((await installed('notify', 'K-2', 'on node')).code, 0)
  assert.equal(readEntries(config.logPath)[1].message, 'on node')
})

const gitBash = WINDOWS && (() => {
  try {
    return execFileSync('sh', ['-c', 'uname -s'], { encoding: 'utf8' }).startsWith('MINGW')
  } catch {
    return false
  }
})()

test('in Git Bash the installed CLI gets its arguments as given', { skip: !gitBash }, async () => {
  const { home, config, workspace, env } = sandbox()
  install(config, home, ROOT)
  const launcher = join(home, '.config', 'agent-inbox', 'bin', 'agent-inbox').replaceAll('\\', '/')
  // Git Bash would turn /api/v1 into C:/Program Files/Git/api/v1 on the way to a Windows program
  const run = await new Promise<Run>((resolve) =>
    execFile('sh', [launcher, 'notify', 'K-1', '/api/v1'], { cwd: workspace, env: env() }, ran(resolve))
  )
  assert.equal(run.code, 0, run.stderr)
  assert.equal(readEntries(config.logPath)[0].message, '/api/v1')
})

test('notify, ask and resolve write the log and move the workspace on the board', async () => {
  const { home, config, workspace, calls, cli } = sandbox()
  install(config, home, ROOT)
  const message = 'tab\there "quotes" back\\slash & 中文\nsecond line'
  assert.equal((await cli('notify', 'K-1', message, 'https://example.com/1?a=1&b=2')).code, 0)
  assert.equal((await cli('ask', 'K-2', 'pick A or B')).code, 0)
  assert.equal((await cli('resolve', 'K-2')).code, 0)
  const entries = readEntries(config.logPath)
  assert.deepEqual(entries.map((e) => [e.kind, e.key]), [['notify', 'K-1'], ['ask', 'K-2'], ['resolve', 'K-2']])
  assert.equal(entries[0].message, message)
  assert.equal(entries[0].url, 'https://example.com/1?a=1&b=2')
  assert.equal(entries[1].worktree, workspace)
  assert.equal(entries[1].terminal, 'term_1')
  assert.deepEqual(calls(), [
    `worktree set --worktree path:${workspace} --workspace-status in-review --comment K-2: pick A or B --unread --json`,
    `worktree show --worktree path:${workspace} --json`,
    `worktree set --worktree path:${workspace} --workspace-status in-progress --comment  --json`
  ])
  // the lines are what the shell CLI of 0.1.2 wrote, field for field
  assert.match(readFileSync(config.logPath, 'utf8').split('\n')[1], /^\{"v":1,"ts":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ","kind":"ask","key":"K-2","message":"pick A or B","url":null,"worktree":".+","terminal":"term_1"\}$/)
})

test('a message of - is Markdown read from stdin, and an ask comments its first line on the board', async () => {
  const { home, config, workspace, calls, cliInput } = sandbox()
  install(config, home, ROOT)
  const markdown = '## Pick the **schema**\n\n- A: `v1`\n- B: `v2`'
  const notified = await cliInput(`${markdown}\n\n`, 'notify', 'K-1', '-', 'https://example.com/1')
  assert.equal(notified.code, 0)
  assert.equal(notified.stdout, 'notify K-1: Pick the **schema**\n')
  assert.equal((await cliInput(markdown, 'ask', 'K-2', '-')).code, 0)
  const entries = readEntries(config.logPath)
  assert.deepEqual(entries.map((e) => e.message), [markdown, markdown])
  assert.equal(entries[0].url, 'https://example.com/1')
  assert.deepEqual(calls(), [`worktree set --worktree path:${workspace} --workspace-status in-review --comment K-2: Pick the **schema** --unread --json`])
  // nothing on stdin is no message
  assert.equal((await cliInput('', 'notify', 'K-3', '-')).code, 2)
})

test('a worktree passed as Git Bash or Git write it on Windows is the path Orca has', { skip: !WINDOWS }, async () => {
  const { home, config, workspace, calls, cli } = sandbox()
  install(config, home, ROOT)
  const gitBash = workspace.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll('\\', '/')
  assert.equal((await cli('ask', '--worktree', gitBash, 'K-3', 'from Git Bash')).code, 0)
  assert.equal(readEntries(config.logPath)[0].worktree, workspace)
  assert.ok(calls()[0].startsWith(`worktree set --worktree path:${workspace} `))
})

test('the log has the workspace as Orca names it, when Orca says', async () => {
  const { home, config, workspace, orca, cli } = sandbox()
  install(config, home, ROOT)
  orca.answer('worktree set', { worktree: { path: `${workspace}-as-orca-has-it` } })
  assert.equal((await cli('ask', 'K-1', 'pick A or B')).code, 0)
  assert.equal(readEntries(config.logPath)[0].worktree, `${workspace}-as-orca-has-it`)
})

test('from WSL the workspace is a Linux path for orca to resolve, and the log has the path Orca answers with', async () => {
  const { home, config, orca, calls, cliWith } = sandbox()
  install(config, home, ROOT)
  const unc = '\\\\wsl.localhost\\Ubuntu\\home\\me\\app'
  orca.answer('worktree set', { worktree: { path: unc } })
  orca.answer('worktree show', { worktree: { path: unc, workspaceStatus: 'in-review' } })
  // what bin/agent-inbox passes on from WSL: the directory it ran in and its Git top level
  const wsl = { AGENT_INBOX_WSL_CWD: '/home/me/app/src', AGENT_INBOX_WSL_TOP: '/home/me/app' }
  assert.equal((await cliWith(wsl, 'notify', 'K-1', 'built')).code, 0)
  assert.equal((await cliWith(wsl, 'ask', 'K-2', 'pick A or B')).code, 0)
  // a relative --worktree is relative to the directory in WSL
  assert.equal((await cliWith(wsl, 'resolve', '--worktree', '..', 'K-2')).code, 0)
  assert.deepEqual(readEntries(config.logPath).map((e) => [e.kind, e.worktree]), [['notify', '/home/me/app'], ['ask', unc], ['resolve', unc]])
  assert.deepEqual(calls(), [
    'worktree set --worktree path:/home/me/app --workspace-status in-review --comment K-2: pick A or B --unread --json',
    'worktree show --worktree path:/home/me/app --json',
    'worktree set --worktree path:/home/me/app --workspace-status in-progress --comment  --json'
  ])

  // outside a repository in WSL there is no workspace to ask in, whatever Git says on Windows
  const outside = await cliWith({ AGENT_INBOX_WSL_CWD: '/tmp', AGENT_INBOX_WSL_TOP: '' }, 'ask', 'K-3', 'x')
  assert.equal(outside.code, 2)
  assert.match(outside.stderr, /no workspace/)
})

test('in WSL the installed CLI passes on the directory and Git top level WSL has, and never runs on its node', POSIX_ONLY, async () => {
  const { home, config, workspace, orca, calls, env } = sandbox()
  // the launcher Orca on Windows writes, run by a WSL whose wslpath leaves these paths as they are
  install(config, home, ROOT, process.execPath, 'win32')
  const bin = join(home, 'wsl-bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'wslpath'), '#!/bin/sh\ncase "$1" in -u|-w) shift ;; esac\nprintf "%s\\n" "$1"\n', { mode: 0o755 })
  const src = join(workspace, 'src')
  mkdirSync(src)
  const wsl = { WSL_DISTRO_NAME: 'Ubuntu', PATH: `${bin}${delimiter}${process.env.PATH}`, AGENT_INBOX_ORCA: orca.command, ORCA_TERMINAL_HANDLE: 'term_wsl' }
  const run = (...args: string[]) =>
    new Promise<Run>((resolve) => execFile(join(home, '.config', 'agent-inbox', 'bin', 'agent-inbox'), args, { cwd: src, env: env(wsl) }, ran(resolve)))

  assert.equal((await run('ask', 'K-1', 'from WSL')).code, 0)
  assert.equal(calls()[0], `worktree set --worktree path:${workspace} --workspace-status in-review --comment K-1: from WSL --unread --json`)
  // orca learns the directory from ORCA_CLI_CWD, in Windows form (here wslpath leaves it as it is)
  assert.deepEqual(orca.cliCwds(), [src])
  assert.equal((await run('notify', '--worktree', '..', 'K-2', 'x')).code, 0)
  const [ask, notify] = readEntries(config.logPath)
  assert.equal(ask.terminal, 'term_wsl')
  assert.equal(notify.worktree, workspace)

  // an Orca that moved: WSL's node would not find the Windows log
  install(config, home, ROOT, join(home, 'gone', 'Orca.exe'), 'win32')
  const gone = await run('notify', 'K-3', 'x')
  assert.equal(gone.code, 3)
  assert.match(gone.stderr, /open Orca to reinstall this CLI/)
  assert.equal(readEntries(config.logPath).length, 2)
})

test('point add, remove and list keep the points beside the log', async () => {
  const { home, config, cli } = sandbox()
  install(config, home, ROOT)
  const when = 'a design "decision" back\\slash 中文'
  assert.equal((await cli('point', 'add', 'design', 'ask', '<ticket>', when, 'CLAUDE.md (A)')).code, 0)
  assert.equal((await cli('point', 'add', 'cleanup', 'notify', 'cleanup', 'the cleanup failed', 'precheck cleanup.sh')).code, 0)
  assert.deepEqual(readPoints(config.logPath), [
    { id: 'design', kind: 'ask', key: '<ticket>', when, wiredIn: 'CLAUDE.md (A)' },
    { id: 'cleanup', kind: 'notify', key: 'cleanup', when: 'the cleanup failed', wiredIn: 'precheck cleanup.sh' }
  ])
  assert.ok(existsSync(join(home, 'state/inbox.points.jsonl')))

  // the same id replaces the point; remove takes it out, and a second remove changes nothing
  assert.equal((await cli('point', 'add', 'design', 'ask', '<ticket>', 'replaced', 'CLAUDE.md (A)')).code, 0)
  assert.equal((await cli('point', 'remove', 'cleanup')).code, 0)
  assert.equal((await cli('point', 'remove', 'cleanup')).stdout, 'no point cleanup\n')
  assert.deepEqual(readPoints(config.logPath).map((p) => [p.id, p.when]), [['design', 'replaced']])
  const list = await cli('point', 'list')
  assert.equal(list.code, 0)
  assert.equal(JSON.parse(list.stdout).when, 'replaced')

  for (const args of [
    ['point', 'add', 'bad id', 'ask', 'K', 'w', 'i'],
    ['point', 'add', 'x', 'shout', 'K', 'w', 'i'],
    ['point', 'add', 'x', 'ask', 'K', 'w'],
    ['point', 'add', 'x', 'ask', 'K', '', 'i'],
    ['point', 'remove'],
    ['point']
  ]) {
    assert.equal((await cli(...args)).code, 2, args.join(' '))
  }
  assert.equal(readPoints(config.logPath).length, 1)
  assert.equal(readEntries(config.logPath).length, 0)
})

test('resolve leaves a workspace the person already moved on alone', async () => {
  const { home, config, calls, cli } = sandbox('completed')
  install(config, home, ROOT)
  assert.equal((await cli('resolve', 'K-2')).code, 0)
  assert.equal(calls().length, 1)
  assert.equal(readEntries(config.logPath)[0].kind, 'resolve')
})

test('hook gives an agent in an Orca terminal the brief, and an agent elsewhere nothing', async () => {
  const { home, config, calls, cli, cliWith } = sandbox()
  install(config, home, ROOT)
  const brief = await cli('hook')
  assert.equal(brief.code, 0)
  assert.match(brief.stdout, /^Agent Inbox is on: /)
  assert.match(brief.stdout, /~\/\.config\/agent-inbox\/bin\/agent-inbox ask <key> /)
  assert.match(brief.stdout, /~\/\.config\/agent-inbox\/bin\/agent-inbox resolve <key>/)
  assert.match(brief.stdout, /~\/\.config\/agent-inbox\/bin\/agent-inbox notify <key> /)
  assert.match(brief.stdout, /you judge what does/)
  assert.equal(brief.stdout.includes('AskUserQuestion'), false)
  assert.deepEqual(await cliWith({ ORCA_TERMINAL_HANDLE: '' }, 'hook'), { code: 0, stdout: '', stderr: '' })
  // with the recommended point recorded, questions asked with AskUserQuestion go by themselves
  assert.equal((await cli('point', 'add', 'builtin.ask-question', 'ask', '<ticket or folder>', 'an agent asks', 'the Agent Inbox plugin')).code, 0)
  const questions = await cli('hook')
  assert.match(questions.stdout, /^- A question you ask with the AskUserQuestion tool reaches the panel by itself\.$/m)
  assert.match(questions.stdout, /^- Before you stop for their decision, approval or help in another way, run$/m)
  assert.match(questions.stdout, /~\/\.config\/agent-inbox\/bin\/agent-inbox resolve <key>/)
  // it only prints: nothing is sent, nothing asks Orca
  assert.equal(readEntries(config.logPath).length, 0)
  assert.deepEqual(calls(), [])
})

test('usage errors exit 2 and a missing orca CLI exits 3 without logging the ask', async () => {
  const { home, config, workspace, cli, env } = sandbox()
  install(config, home, ROOT)
  const notify = await cli('notify', 'K-1')
  assert.equal(notify.code, 2)
  assert.match(notify.stderr, /agent-inbox notify <key> <message>/)
  assert.equal((await cli('shout', 'K-1', 'x')).code, 2)
  const missing = await new Promise<Run>((resolve) =>
    execFile(process.execPath, [CLI, 'ask', 'K-1', 'x'], { cwd: workspace, env: env({ AGENT_INBOX_ORCA: join(home, 'nope') }) }, ran(resolve))
  )
  assert.equal(missing.code, 3)
  assert.match(missing.stderr, /^agent-inbox: orca worktree set failed/)
  assert.equal(readEntries(config.logPath).length, 0)
})

test('prune drops old lines and keeps open asks; the CLI waits for a prune holding the lock', async () => {
  const { home, config, workspace, cli } = sandbox()
  install(config, home, ROOT)
  const now = Date.now()
  const line = (daysAgo: number, kind: string, key: string, wt: string | null) =>
    JSON.stringify({ v: 1, ts: new Date(now - daysAgo * DAY).toISOString(), kind, key, message: key, url: null, worktree: wt, terminal: null })
  writeFileSync(config.logPath, [line(40, 'ask', 'OPEN', workspace), line(9, 'notify', 'OLD', null), line(1, 'notify', 'NEW', null)].join('\n') + '\n')
  assert.equal(prune(config, now), 1)
  assert.deepEqual(readEntries(config.logPath).map((e) => e.key), ['OPEN', 'NEW'])
  assert.equal(prune(config, now), 0)

  // someone holds the lock: prune skips this round, the CLI waits and appends once it is free
  mkdirSync(`${config.logPath}.lock`)
  writeFileSync(config.logPath, readFileSync(config.logPath, 'utf8') + line(30, 'notify', 'OLD2', null) + '\n')
  assert.equal(prune(config, now), 0)
  const pending = cli('notify', 'LATE', 'appended after the lock')
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(readEntries(config.logPath).some((e) => e.key === 'LATE'), false)
  rmdirSync(`${config.logPath}.lock`)
  assert.equal((await pending).code, 0)
  assert.deepEqual(parseLog(readFileSync(config.logPath, 'utf8')).map((e) => e.key), ['OPEN', 'NEW', 'OLD2', 'LATE'])

  // a lock left by a killed process is broken
  mkdirSync(`${config.logPath}.lock`)
  utimesSync(`${config.logPath}.lock`, new Date(now - 60_000), new Date(now - 60_000))
  assert.equal(prune(config, now), 1)
  assert.equal(existsSync(`${config.logPath}.lock`), false)
})
