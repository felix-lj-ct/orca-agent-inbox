// Runs src/worker.ts's activate(orca) over a mock host, on a temporary home with a fake orca CLI.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readEntries } from './store'
import * as main from './worker'

const DAY = 24 * 3600 * 1000

function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'agent-inbox-worker-')))
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  const orca = join(home, 'fake-orca')
  writeFileSync(join(home, 'ps.json'), JSON.stringify({ ok: true, result: { worktrees: [
    { path: workspace, displayName: 'workspace', repo: 'app', workspaceStatus: 'in-review', comment: 'P-1: pick A or B', agents: [] },
    { path: join(home, 'other'), displayName: 'other', repo: 'app', workspaceStatus: 'in-progress', comment: '', agents: [] }
  ] } }))
  writeFileSync(join(home, 'terminals.json'), JSON.stringify({ ok: true, result: { terminals: [
    { handle: 'term_asker', tabId: 't', leafId: 'l', worktreePath: workspace }
  ] } }))
  writeFileSync(
    orca,
    `#!/bin/bash
echo "$*" >> "${home}/orca-calls"
case "$1 $2" in
  "worktree ps") cat "${home}/ps.json" ;;
  "terminal list") cat "${home}/terminals.json" ;;
  "worktree show") echo '{"ok":true,"result":{"worktree":{"workspaceStatus":"in-review"}}}' ;;
  *) echo '{"ok":true,"result":{}}' ;;
esac
`,
    { mode: 0o755 }
  )
  const logPath = join(home, 'state', 'inbox.jsonl')
  const now = Date.now()
  const line = (daysAgo: number, kind: string, key: string, message: string, extra: object = {}) =>
    JSON.stringify({ v: 1, ts: new Date(now - daysAgo * DAY).toISOString(), kind, key, message, url: null, worktree: null, terminal: null, ...extra })
  mkdirSync(join(home, 'state'))
  writeFileSync(
    logPath,
    [
      line(20, 'notify', 'OLD', 'past the window'),
      line(2, 'notify', 'BUILD', 'nightly build failed', { url: 'https://ci/1' }),
      line(1, 'ask', 'P-1', 'pick A or B', { worktree: workspace, terminal: 'term_asker' }),
      line(0.5, 'notify', 'REPORT', 'report posted')
    ].join('\n') + '\n'
  )
  const calls = () => (existsSync(join(home, 'orca-calls')) ? readFileSync(join(home, 'orca-calls'), 'utf8').trim().split('\n') : [])
  return { home, workspace, orca, logPath, calls }
}

/** Runs fn with HOME on the sandbox and without the Orca terminal of whoever runs the tests. */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previous = { HOME: process.env.HOME, ORCA_TERMINAL_HANDLE: process.env.ORCA_TERMINAL_HANDLE }
  process.env.HOME = home
  delete process.env.ORCA_TERMINAL_HANDLE
  try {
    return await fn()
  } finally {
    process.env.HOME = previous.HOME
    if (previous.ORCA_TERMINAL_HANDLE !== undefined) process.env.ORCA_TERMINAL_HANDLE = previous.ORCA_TERMINAL_HANDLE
  }
}

test('installs, prunes, and lists what waits and the recent messages', async () => {
  const { home, workspace, orca, logPath } = sandbox()
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: orca, retentionDays: 7 } })
    const worker = await mountWorker(main, { host })
    const inbox = await worker.request('inbox.list')
    assert.equal(inbox.error, null)
    assert.deepEqual(inbox.waiting, [
      {
        path: workspace,
        key: 'P-1',
        repo: 'app',
        reason: 'pick A or B',
        since: inbox.waiting[0].since,
        url: null,
        terminal: 'term_asker'
      }
    ])
    assert.deepEqual(inbox.messages.map((m) => [m.key, m.text, m.url]), [
      ['REPORT', 'report posted', null],
      ['BUILD', 'nightly build failed', 'https://ci/1']
    ])
    assert.equal(inbox.retentionDays, 7)
    assert.deepEqual(inbox.setup, {
      cli: join(home, '.config/agent-inbox/bin/agent-inbox'),
      guide: join(home, '.config/agent-inbox/agent-guide.md'),
      log: logPath
    })
    assert.ok(existsSync(inbox.setup.cli))
    // the line past the window went on load
    assert.deepEqual(readEntries(logPath).map((e) => e.key), ['BUILD', 'P-1', 'REPORT'])
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  })
})

test('dismiss hides a message; open switches to the terminal that asked', async () => {
  const { home, orca, logPath, workspace, calls } = sandbox()
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: orca } })
    const worker = await mountWorker(main, { host })
    const before = await worker.request('inbox.list')
    assert.deepEqual(await worker.request('inbox.dismiss', { id: before.messages[0].id }), { ok: true })
    const after = await worker.request('inbox.list')
    assert.deepEqual(after.messages.map((m) => m.key), ['BUILD'])

    assert.deepEqual(await worker.request('inbox.open', { path: workspace, terminal: 'term_asker' }), { ok: true })
    assert.ok(calls().includes('terminal switch --terminal term_asker --json'))
    assert.deepEqual(await worker.request('inbox.open', { path: workspace, terminal: null }), { ok: false, error: 'no-terminal' })
    await worker.deactivate()
  })
})

test('resolve runs the CLI, which moves the workspace back and logs it', async () => {
  const { home, orca, logPath, workspace, calls } = sandbox()
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: orca, resumeStatus: 'doing' } })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('inbox.resolve', { path: workspace, key: 'P-1' }), { ok: true })
    assert.ok(calls().includes(`worktree set --worktree path:${workspace} --workspace-status doing --comment  --json`))
    const last = readEntries(logPath).at(-1)
    assert.equal(last?.kind, 'resolve')
    assert.equal(last?.worktree, workspace)
    assert.ok(worker.posts.some((p) => p.event === 'inbox.changed'))
    await worker.deactivate()
  })
})

test('a board it cannot read still lists the messages, with the error', async () => {
  const { home, logPath } = sandbox()
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: join(home, 'no-such-orca') } })
    const worker = await mountWorker(main, { host })
    const inbox = await worker.request('inbox.list')
    assert.deepEqual(inbox.waiting, [])
    assert.equal(inbox.messages.length, 2)
    assert.match(String(inbox.error), /^orca: /)
    await worker.deactivate()
  })
})
