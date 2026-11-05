// install and prune on a temporary home, and the real CLI (cli/agent-inbox.sh) against a fake orca CLI.
import { assert, test } from 'orca/testing'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from './config'
import { parseLog } from './log'
import { install, prune, readEntries } from './store'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'cli', 'agent-inbox.sh')
const DAY = 24 * 3600 * 1000

/** A home with a fake orca CLI that records its calls and reports the workspace in `status`. */
function sandbox(status = 'in-review') {
  // the real path: git reports the workspace without symlinks (macOS /var is /private/var)
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-inbox-')))
  const orca = join(home, 'fake-orca')
  writeFileSync(
    orca,
    `#!/bin/bash
echo "$*" >> "${home}/orca-calls"
case "$1 $2" in
  "worktree show") printf '{\\n  "ok": true,\\n  "result": { "worktree": { "workspaceStatus": "${status}" } }\\n}\\n' ;;
  *) echo '{"ok":true,"result":{}}' ;;
esac
`,
    { mode: 0o755 }
  )
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  // the CLI finds the workspace as the Git top level of the current directory
  execFileSync('git', ['init', '-q', workspace])
  const config = readConfig({ logPath: '~/state/inbox.jsonl' }, home)
  const calls = () => (existsSync(join(home, 'orca-calls')) ? readFileSync(join(home, 'orca-calls'), 'utf8').trim().split('\n') : [])
  const cli = (...args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        '/bin/bash',
        [CLI, ...args],
        { cwd: workspace, env: { HOME: home, PATH: '/usr/bin:/bin', AGENT_INBOX_ORCA: orca, ORCA_TERMINAL_HANDLE: 'term_1' } },
        (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr })
      )
    })
  return { home, workspace, config, calls, cli }
}

test('install puts the CLI, config.env and the guide where agents find them', () => {
  const { home, config } = sandbox()
  const setup = install(config, home, ROOT)
  assert.equal(setup.cli, join(home, '.config/agent-inbox/bin/agent-inbox'))
  assert.equal(statSync(setup.cli).mode & 0o777, 0o755)
  assert.equal(readFileSync(setup.cli, 'utf8'), readFileSync(CLI, 'utf8'))
  assert.match(readFileSync(join(home, '.config/agent-inbox/config.env'), 'utf8'), /AGENT_INBOX_LOG='.*\/state\/inbox\.jsonl'/)
  assert.match(readFileSync(setup.guide, 'utf8'), /^---\nname: agent-inbox\n/)
  assert.ok(existsSync(dirname(config.logPath)))
})

test('the installed CLI follows the settings in config.env', async () => {
  const { home, config, workspace, cli } = sandbox()
  install(config, home, ROOT)
  const where = await new Promise<string>((resolve) =>
    execFile(join(home, '.config/agent-inbox/bin/agent-inbox'), ['where'], { cwd: workspace, env: { HOME: home, PATH: '/usr/bin:/bin' } }, (_e, out) =>
      resolve(out)
    )
  )
  assert.match(where, new RegExp(`log +${config.logPath}`))
  assert.equal((await cli('notify', 'K-1', 'hello')).code, 0)
  assert.equal(readEntries(config.logPath)[0].message, 'hello')
})

test('notify, ask and resolve write the log and move the workspace on the board', async () => {
  const { home, config, workspace, calls, cli } = sandbox()
  install(config, home, ROOT)
  const message = 'tab\there "quotes" back\\slash & 中文\nsecond line'
  assert.equal((await cli('notify', 'K-1', message, 'https://example.com/1')).code, 0)
  assert.equal((await cli('ask', 'K-2', 'pick A or B')).code, 0)
  assert.equal((await cli('resolve', 'K-2')).code, 0)
  const entries = readEntries(config.logPath)
  assert.deepEqual(entries.map((e) => [e.kind, e.key]), [['notify', 'K-1'], ['ask', 'K-2'], ['resolve', 'K-2']])
  assert.equal(entries[0].message, message)
  assert.equal(entries[0].url, 'https://example.com/1')
  assert.equal(entries[1].worktree, workspace)
  assert.equal(entries[1].terminal, 'term_1')
  assert.deepEqual(calls(), [
    `worktree set --worktree path:${workspace} --workspace-status in-review --comment K-2: pick A or B --unread --json`,
    `worktree show --worktree path:${workspace} --json`,
    `worktree set --worktree path:${workspace} --workspace-status in-progress --comment  --json`
  ])
})

test('resolve leaves a workspace the person already moved on alone', async () => {
  const { home, config, calls, cli } = sandbox('completed')
  install(config, home, ROOT)
  assert.equal((await cli('resolve', 'K-2')).code, 0)
  assert.equal(calls().length, 1)
  assert.equal(readEntries(config.logPath)[0].kind, 'resolve')
})

test('usage errors exit 2 and a missing orca CLI exits 3 without logging the ask', async () => {
  const { home, config, workspace, cli } = sandbox()
  install(config, home, ROOT)
  assert.equal((await cli('notify', 'K-1')).code, 2)
  assert.equal((await cli('shout', 'K-1', 'x')).code, 2)
  const missing = await new Promise<number>((resolve) =>
    execFile('/bin/bash', [CLI, 'ask', 'K-1', 'x'], { cwd: workspace, env: { HOME: home, PATH: '/usr/bin:/bin', AGENT_INBOX_ORCA: join(home, 'nope') } }, (e) =>
      resolve(e ? Number(e.code) : 0)
    )
  )
  assert.equal(missing, 3)
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
