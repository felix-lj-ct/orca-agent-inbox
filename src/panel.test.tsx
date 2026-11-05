// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Inbox } from './protocol'

const inbox = (language: Inbox['language'], waiting = true): Inbox => ({
  waiting: waiting
    ? [{ path: '/w/a', key: 'P-1', repo: 'app', reason: 'pick A or B', since: Date.now() - 60_000, url: null, terminal: 'term_1' }]
    : [],
  messages: [{ id: 'm1', at: Date.now() - 3_600_000, key: 'BUILD', text: 'nightly build failed', url: 'https://ci/1', read: false }],
  points: [],
  retentionDays: 7,
  language,
  setup: { cli: '/h/.config/agent-inbox/bin/agent-inbox', guide: '/h/.config/agent-inbox/agent-guide.md', log: '/h/inbox.jsonl' },
  setupPending: false,
  error: null
})

test('shows what waits and the messages, and resolves', async () => {
  const resolved: unknown[] = []
  let current = inbox('en')
  const host = mockHost({
    requests: {
      'inbox.list': () => current,
      'inbox.resolve': (input) => {
        resolved.push(input)
        current = inbox('en', false)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    assert.ok(view.find({ text: 'pick A or B' }))
    assert.ok(view.find({ text: /^BUILD nightly build failed/ }))
    assert.ok(view.find({ text: /^Messages \(1\)/ }))
    assert.ok(view.find({ text: /^Waiting on you \(1\)/ }))
    assert.ok(view.find({ type: 'Button', text: 'Star on GitHub' }))

    await view.press({ text: 'Mark handled' })
    assert.deepEqual(resolved, [{ path: '/w/a', key: 'P-1' }])
    assert.ok(view.find({ text: 'Nothing is waiting on you' }))
    assert.ok(view.find({ text: /^Waiting on you \(0\)/ }))
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view.unmount()
  }
})

test('speaks Chinese when set, and explains a workspace without a terminal', async () => {
  const host = mockHost({
    requests: {
      'inbox.list': () => inbox('zh-CN'),
      'inbox.open': () => ({ ok: false, error: 'no-terminal' })
    }
  })
  const view = await mount(panel, { host })
  try {
    assert.ok(view.find({ text: /^等你处理（1）/ }))
    assert.ok(view.find({ text: /^消息（1）/ }))
    assert.ok(view.find({ type: 'Button', text: '在 GitHub 点 Star' }))
    await view.press({ text: '去处理' })
    assert.ok(view.find({ text: '这个工作区没有打开的终端，请从侧边栏打开它' }))
  } finally {
    await view.unmount()
  }
})

test('lists the newest messages first and the rest behind Show more', async () => {
  const many: Inbox = {
    ...inbox('en', false),
    messages: Array.from({ length: 45 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return { id: `m${n}`, at: Date.now() - (i + 1) * 60_000, key: 'K', text: `note ${n}`, url: null, read: false }
    })
  }
  const host = mockHost({ requests: { 'inbox.list': () => many } })
  const view = await mount(panel, { host })
  try {
    const shown = () => view.findAll({ text: /^K note \d\d/ }).length
    assert.equal(shown(), 20)
    assert.ok(view.find({ text: /^K note 20/ }))
    assert.equal(view.find({ text: /^K note 21/ }), null)

    await view.press({ text: 'Show more (25 more)' })
    assert.equal(shown(), 40)
    await view.press({ text: 'Show more (5 more)' })
    assert.equal(shown(), 45)
    assert.equal(view.find({ text: /^Show more/ }), null)
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('the setup task copies the prompt and goes once handled', async () => {
  const copies: unknown[] = []
  let current: Inbox = { ...inbox('en', false), setupPending: true }
  const host = mockHost({
    requests: {
      'inbox.list': () => current,
      'inbox.copy': (input) => {
        copies.push(input)
        return copies.length === 1 ? { ok: false, error: 'no-clipboard' } : { ok: true }
      },
      'inbox.setupDone': () => {
        current = { ...current, setupPending: false }
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  const prompt = 'Read /h/.config/agent-inbox/agent-guide.md, go through my workflow, and tell me where to send Agent Inbox messages and how to wire each one.'
  try {
    assert.ok(view.find({ text: /^Waiting on you \(1\)/ }))
    assert.ok(view.find({ text: prompt }))
    assert.equal(view.find({ text: 'Nothing is waiting on you' }), null)

    await view.press({ text: 'Copy prompt' })
    assert.ok(view.find({ text: 'No clipboard command found; select the prompt and copy it by hand' }))
    await view.press({ text: 'Copy prompt' })
    assert.deepEqual(copies, [{ text: prompt }, { text: prompt }])
    assert.ok(view.find({ text: 'Copied; paste it to your agent' }))

    await view.press({ text: 'Mark handled' })
    assert.equal(view.find({ text: prompt }), null)
    assert.ok(view.find({ text: /^Waiting on you \(0\)/ }))
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('marks one or all messages read, and keeps the read ones under the Read tab', async () => {
  const marked: unknown[] = []
  const message = (id: string, minutesAgo: number, read: boolean) => ({ id, at: Date.now() - minutesAgo * 60_000, key: id.toUpperCase(), text: `note ${id}`, url: null, read })
  let current: Inbox = { ...inbox('en', false), messages: [message('a', 1, false), message('b', 2, false), message('c', 3, false), message('d', 4, true)] }
  const host = mockHost({
    requests: {
      'inbox.list': () => current,
      'inbox.read': (input) => {
        marked.push(input)
        const ids = new Set((input as { ids: string[] }).ids)
        current = { ...current, messages: current.messages.map((m) => (ids.has(m.id) ? { ...m, read: true } : m)) }
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    const tabs = () => view.findAll({ type: 'Tab' }).map((e) => e.label)
    assert.ok(view.find({ text: /^Messages \(3\)/ }))
    assert.deepEqual(tabs(), ['Unread (3)', 'Read (1)'])
    assert.equal(view.findAll({ text: 'Mark read' }).length, 3)

    await view.press({ text: 'Mark read' })
    assert.deepEqual(marked, [{ ids: ['a'] }])
    assert.ok(view.find({ text: /^Messages \(2\)/ }))
    assert.deepEqual(tabs(), ['Unread (2)', 'Read (2)'])

    await view.press({ text: 'Mark all read' })
    assert.deepEqual(marked[1], { ids: ['b', 'c'] })
    assert.ok(view.find({ text: /^Messages \(0\)/ }))
    assert.ok(view.find({ text: 'No unread messages' }))
    assert.deepEqual(tabs(), ['Unread (0)', 'Read (4)'])
    assert.equal(view.find({ text: 'Mark all read' }), null)
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('groups what waits by project, the project with the newest ask first', async () => {
  const item = (key: string, repo: string, minutesAgo: number | null) => ({
    path: `/w/${key}`,
    key,
    repo,
    reason: `reason ${key}`,
    since: minutesAgo === null ? null : Date.now() - minutesAgo * 60_000,
    url: null,
    terminal: null
  })
  // newest first, as the worker sends them
  const waiting = [item('A-1', 'alpha', 1), item('B-1', 'beta', 2), item('A-2', 'alpha', 3), item('F-1', '', null)]
  const host = mockHost({ requests: { 'inbox.list': () => ({ ...inbox('en'), waiting }) } })
  const view = await mount(panel, { host })
  try {
    assert.ok(view.find({ text: /^Waiting on you \(4\)/ }))
    const titles = view.findAll({ type: 'Collapsible' }).map((e) => e.label).filter((l) => /^(alpha|beta|No project) /.test(String(l)))
    assert.deepEqual(titles, ['alpha (2)', 'beta (1)', 'No project (1)'])
    assert.ok(view.find({ text: 'reason A-2' }))
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('lists the wired points, asks first, and says how they get there when there are none', async () => {
  const point = (id: string, kind: 'ask' | 'notify', when: string) => ({ id, kind, key: '<ticket>', when, wiredIn: 'CLAUDE.md (A)' })
  let current: Inbox = { ...inbox('en', false), points: [point('build', 'notify', 'the build failed'), point('design', 'ask', 'a design decision')] }
  const host = mockHost({ requests: { 'inbox.list': () => current } })
  const view = await mount(panel, { host })
  try {
    // closed until opened, then kept open for the next run of the panel
    assert.equal(view.find({ text: 'a design decision' }), null)
    await view.toggle({ type: 'Collapsible', label: 'Wired points (2)' })
    assert.equal(view.persisted.plugin.pointsOpen, true)
    assert.deepEqual(view.findAll({ type: 'Badge' }).map((e) => e.text), ['Waiting on you', 'Message'])
    assert.ok(view.find({ text: 'a design decision' }))
    assert.equal(view.findAll({ text: 'key <ticket> · CLAUDE.md (A)' }).length, 2)

    current = { ...current, points: [] }
    await view.press({ label: 'Refresh' })
    assert.ok(view.find({ text: /^Wired points \(0\)/ }))
    assert.ok(view.find({ text: /^No points recorded yet/ }))
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view.unmount()
  }
})

test('Add a point, Align and Remove start an agent with a prompt, and say when no workspace is selected', async () => {
  const launched: string[] = []
  const point = { id: 'build-failed', kind: 'notify' as const, key: 'BUILD', when: 'the build failed', wiredIn: 'build.sh' }
  const host = mockHost({
    requests: {
      'inbox.list': () => ({ ...inbox('en', false), points: [point] }),
      'inbox.launch': (input) => {
        launched.push((input as { prompt: string }).prompt)
        return launched.length < 4 ? { ok: true } : { ok: false, error: 'no-workspace' }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    await view.toggle({ type: 'Collapsible', label: 'Wired points (1)' })
    await view.press({ text: 'Add a point' })
    await view.press({ text: 'Align' })
    await view.press({ text: 'Remove' })
    assert.deepEqual(launched, [
      'Read /h/.config/agent-inbox/agent-guide.md and add one Agent Inbox point to my workflow: ask me what should send, wire it where it belongs, and record it with agent-inbox point add.',
      'Read /h/.config/agent-inbox/agent-guide.md and align my Agent Inbox points: compare the recorded points with the agent-inbox calls in my workflow, show me the differences and the point add and point remove commands that fix the records, and run them once I agree. Change no workflow files.',
      'Read /h/.config/agent-inbox/agent-guide.md and remove the Agent Inbox point build-failed (the build failed; wired in build.sh): take its call out of my workflow and run agent-inbox point remove build-failed.'
    ])
    assert.equal(view.find({ text: 'Select a workspace in Orca first; the agent starts there' }), null)
    await view.press({ text: 'Add a point' })
    assert.ok(view.find({ text: 'Select a workspace in Orca first; the agent starts there' }))
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view.unmount()
  }
})

test('Star stars through the worker and then only thanks; without gh it links to the page', async () => {
  let starOk = false
  let stars = 0
  const host = mockHost({
    requests: {
      'inbox.list': () => inbox('en', false),
      'inbox.star': () => {
        stars++
        return starOk ? { ok: true } : { ok: false, error: 'gh: To get started with GitHub CLI, please run:  gh auth login' }
      }
    }
  })
  const failing = await mount(panel, { host })
  try {
    await failing.press({ text: 'Star on GitHub' })
    assert.equal(stars, 1)
    assert.equal(failing.find({ text: 'Star on GitHub' }), null)
    assert.ok(failing.find({ text: /^Starring from here needs the gh CLI/ }))
    assert.equal(failing.find({ type: 'Link', text: 'star it on the page' })?.props.href, 'https://github.com/felix-lj-ct/orca-agent-inbox')
    // a footer matter, not the inbox's
    assert.equal(failing.findAll({ type: 'Callout' }).length, 0)
    assert.deepEqual(failing.errors, [])
  } finally {
    await failing.unmount()
  }

  starOk = true
  const view = await mount(panel, { host })
  try {
    await view.press({ text: 'Star on GitHub' })
    assert.equal(stars, 2)
    assert.ok(view.find({ text: 'Starred on GitHub. Thank you!' }))
    assert.equal(view.find({ text: 'Star on GitHub' }), null)
    assert.equal(view.persisted.plugin.starred, true)
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view.unmount()
  }
})
