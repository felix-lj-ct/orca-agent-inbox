// The WSL side: which distros the worker links, the link it makes (on any POSIX system, with a stand-in wslpath),
// and, on Windows with AGENT_INBOX_TEST_WSL naming a WSL distro (CI sets it), the whole way through a real one:
// the worker links ~/.config/agent-inbox there, and the CLI run in WSL writes the Windows log and calls orca on
// Windows. That run changes ~/.config/agent-inbox in the distro, so it never runs without the variable.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from './config'
import { fakeOrca } from './fake-orca'
import { readEntries } from './store'
import * as main from './worker'
import { distroNames, LINK_SCRIPT, WSL_EXE, wslDistros } from './wsl'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WINDOWS = process.platform === 'win32'
const DISTRO = WINDOWS ? process.env.AGENT_INBOX_TEST_WSL : undefined

type Run = { code: number; stdout: string; stderr: string }
const ran = (resolve: (run: Run) => void) => (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) =>
  resolve({ code: error ? Number(error.code) : 0, stdout, stderr })

test('the distros are those of the workspaces Orca has in WSL, under either name of the share', () => {
  const worktrees = [
    { path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\app' },
    { path: '\\\\wsl$\\ubuntu\\home\\me\\other' },
    { path: '//wsl.localhost/Debian/srv/x' },
    { path: 'C:\\Users\\me\\app' },
    { path: '\\\\server\\share\\app' },
    { path: null }
  ]
  assert.deepEqual(wslDistros(worktrees), ['Ubuntu', 'Debian'])
})

test('distro names read the same from a wsl.exe that prints UTF-8 and one that prints UTF-16', () => {
  assert.deepEqual(distroNames('Ubuntu-24.04\r\nDebian\r\n'), ['Ubuntu-24.04', 'Debian'])
  const utf16 = Buffer.from('Ubuntu-24.04\r\nDebian\r\n', 'utf16le').toString('utf8')
  assert.deepEqual(distroNames(`\uFEFF${utf16}`), ['Ubuntu-24.04', 'Debian'])
  assert.deepEqual(distroNames(''), [])
})

test('the link points ~/.config/agent-inbox at the Windows folder, says so once, and leaves a folder alone', { skip: WINDOWS }, async () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-inbox-wsl-')))
  const bin = join(home, 'bin')
  mkdirSync(bin)
  // wslpath as it treats a path already in WSL
  writeFileSync(join(bin, 'wslpath'), '#!/bin/sh\n[ "$1" = -u ] && shift\nprintf "%s\\n" "$1"\n', { mode: 0o755 })
  const windows = join(home, 'windows', '.config', 'agent-inbox')
  mkdirSync(windows, { recursive: true })
  const link = (as: string) =>
    new Promise<Run>((resolve) =>
      execFile('sh', ['-c', LINK_SCRIPT, 'sh', windows], { env: { ...process.env, HOME: as, PATH: `${bin}${delimiter}${process.env.PATH}` } }, ran(resolve))
    )

  const linux = join(home, 'linux')
  mkdirSync(linux)
  const first = await link(linux)
  assert.equal(first.code, 0, first.stderr)
  assert.equal(first.stdout, `linked ${linux}/.config/agent-inbox to ${windows}\n`)
  assert.equal(readlinkSync(join(linux, '.config', 'agent-inbox')), windows)
  assert.deepEqual(await link(linux), { code: 0, stdout: '', stderr: '' })

  // a link elsewhere is the plugin's to move; a folder is the person's
  const moved = join(home, 'moved')
  mkdirSync(join(moved, '.config'), { recursive: true })
  writeFileSync(join(moved, 'old'), '')
  symlinkSync(join(moved, 'old'), join(moved, '.config', 'agent-inbox'))
  assert.equal((await link(moved)).code, 0)
  assert.equal(readlinkSync(join(moved, '.config', 'agent-inbox')), windows)

  const own = join(home, 'own')
  mkdirSync(join(own, '.config', 'agent-inbox'), { recursive: true })
  const kept = await link(own)
  assert.equal(kept.code, 0)
  assert.match(kept.stdout, /is a folder of its own: left as it is/)
  assert.ok(lstatSync(join(own, '.config', 'agent-inbox')).isDirectory())
})

test('in a WSL distro, the worker links the CLI, which asks, notifies and resolves through Windows', { skip: !DISTRO }, async () => {
  const distro = DISTRO as string
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-inbox-wsl-')))
  const orca = fakeOrca(home)
  const logPath = join(home, 'state', 'inbox.jsonl')
  const wsl = (args: string[], env: Record<string, string> = {}) =>
    new Promise<Run>((resolve) => execFile(WSL_EXE, ['-d', distro, '--exec', ...args], { env: { ...process.env, ...env } }, ran(resolve)))

  // a workspace in the distro's own file system, as Orca names it
  const made = await wsl(['sh', '-c', 'd=$(mktemp -d) && git init -q "$d/app" && mkdir "$d/app/src" && echo "$d/app"'])
  assert.equal(made.code, 0, made.stderr)
  const linux = made.stdout.trim()
  const unc = `\\\\wsl.localhost\\${distro}${linux.replaceAll('/', '\\')}`
  orca.answer('worktree ps', { worktrees: [{ path: unc, displayName: 'app', repo: 'app', workspaceStatus: 'in-progress', agents: [] }] })
  orca.answer('worktree set', { worktree: { path: unc } })
  orca.answer('worktree show', { worktree: { path: unc, workspaceStatus: 'in-review' } })

  // the worker links only a running distro: keep it running
  const holder: ChildProcess = spawn(WSL_EXE, ['-d', distro, '--exec', 'sleep', '120'], { stdio: 'ignore' })
  // what wsl.exe and so the Windows programs run from WSL get; Orca's terminals get APPDATA, as the runner has it
  const env = { USERPROFILE: home, HOME: home, NODE_OPTIONS: orca.nodeOptions }
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]))
  Object.assign(process.env, env)
  try {
    const running = await new Promise<Run>((resolve) => execFile(WSL_EXE, ['--list', '--running', '--quiet'], ran(resolve)))
    assert.ok(distroNames(running.stdout).some((d) => d.toLowerCase() === distro.toLowerCase()), running.stdout)

    const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca.command } }) })
    await worker.request('inbox.list', {})
    for (let i = 0; i < 100 && !worker.logs.some((l) => l.startsWith(`WSL ${distro}:`)); i++) await new Promise((r) => setTimeout(r, 200))
    assert.ok(worker.logs.some((l) => /^WSL .*: linked .*\/\.config\/agent-inbox to \//.test(l)), worker.logs.join('\n'))
    await worker.deactivate()

    // the CLI as the guide calls it, in a directory of the workspace, in a terminal Orca named term_wsl; the
    // arguments come base64 so that only WSL's way to Windows can change them
    const run = [
      'cd "$1/src" || exit 1',
      'shift',
      'n=$#',
      'while [ $n -gt 0 ]; do a=$(printf %s "$1" | base64 -d; echo x); set -- "$@" "${a%x}"; shift; n=$((n - 1)); done',
      'export ORCA_TERMINAL_HANDLE=term_wsl',
      'exec "$HOME/.config/agent-inbox/bin/agent-inbox" "$@"'
    ].join('; ')
    const agentInbox = (...args: string[]) => wsl(['sh', '-c', run, 'sh', linux, ...args.map((a) => Buffer.from(a).toString('base64'))])
    const where = await agentInbox('where')
    assert.equal(where.code, 0, where.stderr)
    assert.equal(/^log +(.*)$/m.exec(where.stdout)?.[1].trim(), logPath)

    const message = 'a & b | c < d > e ^ f "g" 中文\nsecond line'
    const url = 'https://ci.example.com/run?id=1&tab=log'
    const ask = await agentInbox('ask', 'K-1', message, url)
    assert.equal(ask.code, 0, ask.stderr)
    const notify = await agentInbox('notify', 'K-2', 'built')
    assert.equal(notify.code, 0, notify.stderr)
    const resolve = await agentInbox('resolve', 'K-1')
    assert.equal(resolve.code, 0, resolve.stderr)

    const entries = readEntries(logPath)
    assert.deepEqual(entries.map((e) => [e.kind, e.key, e.worktree]), [
      ['ask', 'K-1', unc],
      ['notify', 'K-2', linux],
      ['resolve', 'K-1', unc]
    ])
    assert.equal(entries[0].message, message)
    assert.equal(entries[0].url, url)
    assert.equal(entries[0].terminal, 'term_wsl')
    // orca resolves the Linux paths in the distro it learns from ORCA_CLI_CWD, the directory in Windows form
    // (wslpath writes the share as wsl.localhost, or as wsl$ in an older WSL)
    const src = `${distro}${linux}/src`.replaceAll('/', '\\').toLowerCase()
    const cwds = orca.cliCwds()
    assert.equal(cwds.length, 3, cwds.join('\n'))
    for (const cwd of cwds) assert.ok([`\\\\wsl.localhost\\${src}`, `\\\\wsl$\\${src}`].includes(cwd.toLowerCase()), cwd)
    // one call a line: the message's line break splits its call in two
    const calls = orca.calls().filter((c) => !/^(worktree ps|terminal list) /.test(c)).join('\n')
    assert.equal(
      calls,
      [
        `worktree set --worktree path:${linux} --workspace-status in-review --comment K-1: ${message} --unread --json`,
        `worktree show --worktree path:${linux} --json`,
        `worktree set --worktree path:${linux} --workspace-status in-progress --comment  --json`
      ].join('\n')
    )
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    holder.kill()
  }
})
