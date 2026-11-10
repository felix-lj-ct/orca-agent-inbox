// Runs src/worker.ts's activate(orca) over a mock host, on a temporary home with a fake orca CLI.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fakeOrca } from './fake-orca'
import { orcaDataDir } from './launch'
import { RECOMMENDED } from './recommended'
import { cliPath, readEntries, readPoints } from './store'
import * as main from './worker'

const DAY = 24 * 3600 * 1000
/** gh is faked as a shell script on PATH; Windows runs neither the script nor the command. */
const POSIX_ONLY = { skip: process.platform === 'win32' }

function sandbox() {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-inbox-worker-')))
  const workspace = join(home, 'workspace')
  mkdirSync(workspace)
  const fake = fakeOrca(home)
  const worktrees = [
    {
      worktreeId: `app::${workspace}`,
      path: workspace,
      branch: 'feature/PROJ-7-pick',
      displayName: 'workspace',
      repo: 'app',
      workspaceStatus: 'in-review',
      comment: 'P-1: pick A or B',
      agents: [],
      isActive: true
    },
    { path: join(home, 'other'), displayName: 'other', repo: 'app', workspaceStatus: 'in-progress', comment: '', agents: [] }
  ]
  fake.answer('worktree ps', { worktrees })
  fake.answer('terminal list', { terminals: [{ handle: 'term_asker', tabId: 't', leafId: 'l', worktreePath: workspace }] })
  fake.answer('worktree show', { worktree: { workspaceStatus: 'in-review' } })
  const orca = fake.command
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
  writeFileSync(
    join(home, 'state', 'inbox.points.jsonl'),
    JSON.stringify({ v: 1, id: 'build', kind: 'notify', key: 'BUILD', when: 'the nightly build failed', wiredIn: 'build.sh', ts: new Date(now).toISOString() }) + '\n'
  )
  return { home, workspace, orca, logPath, calls: fake.calls, worktrees, answer: fake.answer }
}

/**
 * Runs fn with the home folder (and Orca's data folder in it) on the sandbox, the fake orca preloaded into the
 * processes the worker starts, and without the Orca terminal of whoever runs the tests. Like Orca's workers, it
 * gets no APPDATA or LOCALAPPDATA.
 */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const env: Record<string, string | undefined> = {
    HOME: home,
    USERPROFILE: home,
    APPDATA: undefined,
    LOCALAPPDATA: undefined,
    XDG_CONFIG_HOME: undefined,
    ORCA_TERMINAL_HANDLE: undefined,
    NODE_OPTIONS: fakeOrca(home).nodeOptions
  }
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]))
  const set = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  set(env)
  try {
    return await fn()
  } finally {
    set(previous)
  }
}

/** Waits for what the worker does in the background, such as the ask of an AskUserQuestion call. */
async function until(done: () => boolean, logs: readonly string[], ms = 20_000): Promise<void> {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out waiting for the worker; it logged: ${logs.join(' | ')}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
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
        terminal: 'term_asker',
        resumed: false
      }
    ])
    assert.deepEqual(inbox.messages.map((m) => [m.key, m.text, m.url]), [
      ['REPORT', 'report posted', null],
      ['BUILD', 'nightly build failed', 'https://ci/1']
    ])
    assert.deepEqual([inbox.unreadCount, inbox.readCount], [2, 0])
    assert.deepEqual(inbox.points, [{ id: 'build', kind: 'notify', key: 'BUILD', when: 'the nightly build failed', wiredIn: 'build.sh' }])
    assert.equal(inbox.retentionDays, 7)
    assert.deepEqual(inbox.setup, {
      cli: cliPath(home),
      guide: join(home, '.config', 'agent-inbox', 'agent-guide.md'),
      log: logPath
    })
    assert.ok(existsSync(inbox.setup.cli))
    // a log from before the first start: already set up
    assert.equal(inbox.setupPending, false)
    // the line past the window went on load
    assert.deepEqual(readEntries(logPath).map((e) => e.key), ['BUILD', 'P-1', 'REPORT'])
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  })
})

test('read marks messages read and keeps listing them; open switches to the terminal that asked', async () => {
  const { home, orca, logPath, workspace, calls } = sandbox()
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: orca } })
    const worker = await mountWorker(main, { host })
    const before = await worker.request('inbox.list')
    assert.deepEqual(before.messages.map((m) => [m.key, m.read]), [['REPORT', false], ['BUILD', false]])
    assert.deepEqual(await worker.request('inbox.read', { ids: [before.messages[0].id] }), { ok: true })
    const after = await worker.request('inbox.list')
    // unread first, then read, each newest first
    assert.deepEqual(after.messages.map((m) => [m.key, m.read]), [['BUILD', false], ['REPORT', true]])
    await worker.request('inbox.read', { ids: after.messages.map((m) => m.id) })
    assert.deepEqual((await worker.request('inbox.list')).messages.map((m) => m.read), [true, true])

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

test('asks kept until handled stay after the agent resolves and the card moves, until Mark handled', async () => {
  const { home, orca, logPath, workspace, worktrees, answer } = sandbox()
  const entry = (at: number, kind: string, key: string, worktree: string) =>
    JSON.stringify({ v: 1, ts: new Date(at).toISOString(), kind, key, message: kind === 'ask' ? `${key} asks` : '', url: null, worktree, terminal: null })
  const append = (kind: string, key: string, worktree: string, at = Date.now()) =>
    writeFileSync(logPath, `${readFileSync(logPath, 'utf8')}${entry(at, kind, key, worktree)}\n`)
  const other = join(home, 'other')
  // resolved before the setting goes on: it does not come back
  append('ask', 'GONE', other, Date.now() - 30 * 60_000)
  append('resolve', 'GONE', other, Date.now() - 20 * 60_000)
  const waiting = async (worker: Awaited<ReturnType<typeof mountWorker>>) =>
    (await worker.request('inbox.list')).waiting.map((w) => [w.key, w.resumed])
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: orca, keepAsksUntilHandled: true } })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await waiting(worker), [['P-1', false]])
    assert.equal(typeof host.data().storage.holdSince, 'number')

    // the agent got its answer: it resolves, and the card moves back
    append('resolve', 'P-1', workspace)
    answer('worktree ps', { worktrees: worktrees.map((w) => ({ ...w, workspaceStatus: 'in-progress' })) })
    answer('worktree show', { worktree: { workspaceStatus: 'in-progress' } })
    assert.deepEqual(await waiting(worker), [['P-1', true]])

    assert.deepEqual(await worker.request('inbox.resolve', { path: workspace, key: 'P-1' }), { ok: true })
    assert.deepEqual(await waiting(worker), [])

    // a new ask in the workspace is kept again
    append('ask', 'P-2', workspace)
    assert.deepEqual(await waiting(worker), [['P-2', false]])
    await worker.deactivate()

    // off: the card decides again, and what was kept goes
    const off = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca }, storage: host.data().storage as Record<string, never> }) })
    assert.deepEqual(await waiting(off), [])
    await off.deactivate()
  })
})

test('messages hidden before read and unread existed count as read', async () => {
  const { home, orca, logPath } = sandbox()
  await withHome(home, async () => {
    const first = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
    const ids = (await first.request('inbox.list')).messages.map((m) => m.id)
    await first.deactivate()

    const host = mockHost({ settings: { logPath, orcaCli: orca }, storage: { dismissed: [ids[1]] } })
    const worker = await mountWorker(main, { host })
    assert.deepEqual((await worker.request('inbox.list')).messages.map((m) => [m.key, m.read]), [['REPORT', false], ['BUILD', true]])
    // the next read moves them over
    await worker.request('inbox.read', { ids: [ids[0]] })
    const stored = host.data().storage
    assert.deepEqual([...(stored.read as string[])].sort(), [...ids].sort())
    assert.equal('dismissed' in stored, false)
    await worker.deactivate()
  })
})

test('read ids stored before 0.1.2, the message text itself, still count', async () => {
  const { home, orca, logPath } = sandbox()
  const build = readEntries(logPath).find((e) => e.key === 'BUILD')
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath, orcaCli: orca }, storage: { read: [`${build?.at}|BUILD|nightly build failed`] } })
    const worker = await mountWorker(main, { host })
    const inbox = await worker.request('inbox.list')
    assert.deepEqual(inbox.messages.map((m) => [m.key, m.read]), [['REPORT', false], ['BUILD', true]])
    assert.ok(inbox.messages.every((m) => /^[0-9a-f]{16}$/.test(m.id)))
    // the next read stores them as they are now
    await worker.request('inbox.read', { ids: [inbox.messages[0].id] })
    assert.deepEqual([...(host.data().storage.read as string[])].sort(), inbox.messages.map((m) => m.id).sort())
    await worker.deactivate()
  })
})

test('sends as many messages of each tab as asked, and Mark all read reaches the ones not sent', async () => {
  const { home, orca, logPath } = sandbox()
  const now = Date.now()
  const notify = (minutesAgo: number, key: string) =>
    JSON.stringify({ v: 1, ts: new Date(now - minutesAgo * 60_000).toISOString(), kind: 'notify', key, message: `note ${key}`, url: null, worktree: null, terminal: null })
  writeFileSync(logPath, Array.from({ length: 30 }, (_, i) => notify(30 - i, `N${String(i + 1).padStart(2, '0')}`)).join('\n') + '\n')
  await withHome(home, async () => {
    const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
    const first = await worker.request('inbox.list', { unread: 5, read: 5 })
    assert.deepEqual(first.messages.map((m) => m.key), ['N30', 'N29', 'N28', 'N27', 'N26'])
    assert.deepEqual([first.unreadCount, first.readCount], [30, 0])

    // N31 arrives after the panel drew N30: Mark all read leaves it unread
    writeFileSync(logPath, `${readFileSync(logPath, 'utf8')}${notify(0, 'N31')}\n`)
    assert.deepEqual(await worker.request('inbox.readAll', { through: first.messages[0].at }), { ok: true })
    const after = await worker.request('inbox.list', { unread: 5, read: 3 })
    assert.deepEqual([after.unreadCount, after.readCount], [1, 30])
    assert.deepEqual(after.messages.map((m) => [m.key, m.read]), [['N31', false], ['N30', true], ['N29', true], ['N28', true]])
    await worker.deactivate()
  })
})

test('cuts long texts and leaves out long links, and stops before the answer would pass 1 MiB', async () => {
  const { home, orca, logPath } = sandbox()
  const now = Date.now()
  const notify = (i: number, message: string, url: string | null = null) =>
    JSON.stringify({ v: 1, ts: new Date(now - (i + 1) * 1000).toISOString(), kind: 'notify', key: `K${i}`, message, url, worktree: null, terminal: null })
  writeFileSync(
    logPath,
    [
      notify(0, 'x'.repeat(5_000), `https://ci/${'q'.repeat(9_000)}`),
      // 2,000 Chinese characters: 6 KB a message as UTF-8
      ...Array.from({ length: 400 }, (_, i) => notify(i + 1, '长'.repeat(3_000)))
    ]
      .reverse()
      .join('\n') + '\n'
  )
  await withHome(home, async () => {
    const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
    const inbox = await worker.request('inbox.list', { unread: 1_000, read: 0 })
    const [long] = inbox.messages
    assert.equal(long.text, `${'x'.repeat(2_000)}…`)
    assert.equal(long.url, null)
    assert.equal(inbox.unreadCount, 401)
    assert.ok(inbox.messages.length < 401)
    assert.ok(Buffer.byteLength(JSON.stringify(inbox)) < 1024 * 1024)
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

test('a first start without a log puts up the setup task, which stays gone once handled', async () => {
  const { home, orca } = sandbox()
  await withHome(home, async () => {
    const host = mockHost({ settings: { logPath: join(home, 'state', 'new.jsonl'), orcaCli: orca } })
    const first = await mountWorker(main, { host })
    assert.equal((await first.request('inbox.list')).setupPending, true)
    assert.deepEqual(await first.request('inbox.setupDone'), { ok: true })
    assert.equal((await first.request('inbox.list')).setupPending, false)
    await first.deactivate()

    // still no log on the next start, and the task does not come back
    const second = await mountWorker(main, { host })
    assert.equal((await second.request('inbox.list')).setupPending, false)
    await second.deactivate()
  })
})

test("launch starts Orca's default agent with the prompt in the selected workspace, and needs one selected", async () => {
  const { home, orca, logPath, workspace, calls, worktrees, answer } = sandbox()
  await withHome(home, async () => {
    // the older data file is enough here; src/launch.test.ts covers profile-state.db
    const profile = join(orcaDataDir(home, process.platform, process.env), 'profiles', 'local-default')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'orca-data.json'), JSON.stringify({ settings: { defaultTuiAgent: 'codex' } }))
    const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
    assert.deepEqual(await worker.request('inbox.launch', { prompt: 'add a point' }), { ok: true })
    assert.ok(calls().includes(`agent launch --agent codex --worktree path:${workspace} --prompt add a point --focus --json`))

    answer('worktree ps', { worktrees: worktrees.map((w) => ({ ...w, isActive: false })) })
    assert.deepEqual(await worker.request('inbox.launch', { prompt: 'add a point' }), { ok: false, error: 'no-workspace' })
    await worker.deactivate()
  })
})

test('star stars the repository through gh, and passes on why gh could not', POSIX_ONLY, async () => {
  const { home, orca, logPath } = sandbox()
  const bin = join(home, 'bin')
  mkdirSync(bin)
  // first on PATH, so the tests never reach a real gh
  const gh = join(bin, 'gh')
  writeFileSync(gh, `#!/bin/bash\necho "$*" >> "${home}/gh-calls"\n`, { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${path}`
  try {
    await withHome(home, async () => {
      const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
      assert.deepEqual(await worker.request('inbox.star'), { ok: true })
      assert.equal(readFileSync(join(home, 'gh-calls'), 'utf8'), 'api --method PUT /user/starred/felix-lj-ct/orca-agent-inbox\n')

      writeFileSync(gh, `#!/bin/bash\necho 'To get started with GitHub CLI, please run:  gh auth login' >&2\nexit 4\n`, { mode: 0o755 })
      const failed = await worker.request('inbox.star')
      assert.equal(failed.ok, false)
      assert.match(String(failed.error), /gh auth login/)
      await worker.deactivate()
    })
  } finally {
    process.env.PATH = path
  }
})

test('Recommended points are recorded and removed through the CLI; another id is refused', async () => {
  const { home, orca, logPath } = sandbox()
  await withHome(home, async () => {
    const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
    assert.equal((await worker.request('inbox.list')).showRecommendations, true)
    assert.deepEqual(await worker.request('inbox.addRecommended', { id: 'builtin.ask-question' }), { ok: true })
    assert.deepEqual((await worker.request('inbox.list')).points.map((p) => p.id), ['build', 'builtin.ask-question'])
    assert.deepEqual(readPoints(logPath)[1], RECOMMENDED[0])

    assert.deepEqual(await worker.request('inbox.removeRecommended', { id: 'builtin.ask-question' }), { ok: true })
    // the points of the workflow are an agent's to change
    assert.deepEqual(await worker.request('inbox.addRecommended', { id: 'build' }), { ok: false, error: 'no recommended point build' })
    assert.deepEqual(await worker.request('inbox.removeRecommended', { id: 'build' }), { ok: false, error: 'no recommended point build' })
    assert.deepEqual(readPoints(logPath).map((p) => p.id), ['build'])
    await worker.deactivate()

    const off = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca, showRecommendations: false } }) })
    assert.equal((await off.request('inbox.list')).showRecommendations, false)
    await off.deactivate()
  })
})

test("an agent's AskUserQuestion asks in its workspace and terminal while the point is recorded, and resolves once answered", async () => {
  const { home, orca, logPath, workspace, calls } = sandbox()
  const questions = { questions: [{ question: 'Ship  it\n now?', header: 'Ship', options: [], multiSelect: false }, { question: 'And tag it?', header: 'Tag', options: [], multiSelect: false }] }
  const call = (tool: string, workspaceId = `app::${workspace}`) => ({ agent: 'claude', workspaceId, terminalId: 'term_q', tool, input: questions, callId: 'toolu_1' })
  const asks = () => readEntries(logPath).filter((e) => e.key === 'PROJ-7')
  await withHome(home, async () => {
    const worker = await mountWorker(main, { host: mockHost({ settings: { logPath, orcaCli: orca } }) })
    // every tool call goes on as it was, and only a recorded point sends
    assert.deepEqual(await worker.hooks.fire('agent.tool.before', call('Bash')), { kind: 'continue', event: call('Bash') })
    assert.equal((await worker.hooks.fire('agent.tool.before', call('AskUserQuestion'))).kind, 'continue')
    assert.deepEqual(await worker.request('inbox.addRecommended', { id: 'builtin.ask-question' }), { ok: true })
    // a workspace Orca does not list sends nothing either
    await worker.hooks.fire('agent.tool.before', call('AskUserQuestion', 'app::/nowhere'))

    await worker.hooks.fire('agent.tool.before', call('AskUserQuestion'))
    await until(() => asks().length > 0, worker.logs)
    assert.deepEqual(
      asks().map((e) => [e.kind, e.message, e.worktree, e.terminal]),
      [['ask', 'Ship it now? (1/2)', workspace, 'term_q']]
    )
    assert.ok(calls().includes(`worktree set --worktree path:${workspace} --workspace-status in-review --comment PROJ-7: Ship it now? (1/2) --unread --json`))

    await worker.hooks.fire('agent.tool.after', { ...call('AskUserQuestion'), output: { answers: {} } })
    await until(() => asks().length > 1, worker.logs)
    assert.deepEqual(asks().map((e) => e.kind), ['ask', 'resolve'])
    assert.equal(calls().filter((c) => c.startsWith('worktree set')).length, 2)
    assert.deepEqual(worker.logs.filter((l) => l.startsWith('AskUserQuestion')), [])
    await worker.deactivate()
  })
})
