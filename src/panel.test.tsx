// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, hostError, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Inbox, InboxMessage } from './protocol'

const inbox = (language: Inbox['language'], waiting = true): Inbox => ({
  waiting: waiting
    ? [{ path: '/w/a', key: 'P-1', repo: 'app', reason: 'pick A or B', since: Date.now() - 60_000, url: null, terminal: 'term_1', resumed: false }]
    : [],
  messages: [{ id: 'm1', at: Date.now() - 3_600_000, key: 'BUILD', text: 'nightly build failed', url: 'https://ci/1', read: false }],
  unreadCount: 1,
  readCount: 0,
  points: [],
  retentionDays: 7,
  keepMessagesUntilRead: false,
  showRecommendations: true,
  language,
  setup: { cli: '/h/.config/agent-inbox/bin/agent-inbox', guide: '/h/.config/agent-inbox/agent-guide.md', log: '/h/inbox.jsonl' },
  setupPending: false,
  error: null
})

/** The inbox with these messages and their counts, as the worker sends it when it holds no more. */
const withMessages = (messages: InboxMessage[]): Inbox => ({
  ...inbox('en', false),
  messages,
  unreadCount: messages.filter((m) => !m.read).length,
  readCount: messages.filter((m) => m.read).length
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
    assert.ok(view.find({ type: 'Collapsible', label: '消息（1）' }))
    assert.ok(view.find({ type: 'Text', text: '近 7 天' }))
    assert.ok(view.find({ type: 'Button', text: '在 GitHub 点 Star' }))
    await view.press({ text: '去处理' })
    assert.ok(view.find({ text: '这个工作区没有打开的终端，请从侧边栏打开它' }))
  } finally {
    await view.unmount()
  }
})

test('messages and reasons are Markdown', async () => {
  const text = '## Build failed\n\n- step `test`\n- see **logs**'
  const host = mockHost({
    requests: {
      'inbox.list': () => ({
        ...inbox('en'),
        waiting: [{ ...inbox('en').waiting[0], reason: 'Pick one:\n1. `A`\n2. `B`' }],
        messages: [{ id: 'm1', at: Date.now(), key: 'BUILD', text, url: null, read: false }]
      })
    }
  })
  const view = await mount(panel, { host })
  try {
    const shown = view.findAll({ type: 'Markdown' }).map((node) => String(node.props.content))
    assert.deepEqual(shown, ['Pick one:\n1. `A`\n2. `B`', text])
    assert.ok(view.find({ type: 'Text', text: 'BUILD' }))
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view.unmount()
  }
})

test('a long message shows its start, and Show more shows it whole until Show less', async () => {
  const text = Array.from({ length: 10 }, (_, i) => `- line ${i + 1}`).join('\n')
  const host = mockHost({
    requests: { 'inbox.list': () => ({ ...inbox('en', false), messages: [{ id: 'm1', at: Date.now(), key: 'LONG', text, url: null, read: false }] }) }
  })
  const view = await mount(panel, { host })
  const shown = () => String(view.find({ type: 'Markdown' })?.props.content)
  try {
    assert.equal(shown(), '- line 1\n- line 2\n- line 3\n- line 4\n- line 5\n- line 6 …')
    await view.press({ text: 'Show more' })
    assert.equal(shown(), text)
    await view.press({ text: 'Show less' })
    assert.ok(shown().endsWith('…'))
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('asks the worker for the newest messages, and Show more asks for more', async () => {
  const all: InboxMessage[] = Array.from({ length: 45 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return { id: `m${n}`, at: Date.now() - (i + 1) * 60_000, key: 'K', text: `note ${n}`, url: null, read: false }
  })
  const asked: unknown[] = []
  const host = mockHost({
    requests: {
      'inbox.list': (input) => {
        asked.push(input)
        return { ...withMessages(all), messages: all.slice(0, (input as { unread: number }).unread) }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    const shown = () => view.findAll({ text: /^K note \d\d/ }).length
    assert.equal(shown(), 20)
    assert.ok(view.find({ text: /^K note 20/ }))
    assert.equal(view.find({ text: /^K note 21/ }), null)
    assert.ok(view.find({ text: /^Messages \(45\)/ }))

    await view.press({ text: 'Show more (25 more)' })
    assert.equal(shown(), 40)
    await view.press({ text: 'Show more (5 more)' })
    assert.equal(shown(), 45)
    assert.equal(view.find({ text: /^Show more/ }), null)
    assert.deepEqual(asked, [{ unread: 20, read: 20 }, { unread: 40, read: 20 }, { unread: 60, read: 20 }])
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('the setup task sends the person to Add a point and goes once handled', async () => {
  let current: Inbox = { ...inbox('en', false), setupPending: true }
  const host = mockHost({
    requests: {
      'inbox.list': () => current,
      'inbox.setupDone': () => {
        current = { ...current, setupPending: false }
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  const body =
    'Open Wired points below and press Add a point: your agent asks what should send here, wires it into your workflow and records it. Recommended points, under it, wire in with one press.'
  try {
    assert.ok(view.find({ text: /^Waiting on you \(1\)/ }))
    assert.ok(view.find({ text: body }))
    assert.equal(view.find({ text: 'Nothing is waiting on you' }), null)

    await view.press({ text: 'Mark handled' })
    assert.equal(view.find({ text: body }), null)
    assert.ok(view.find({ text: /^Waiting on you \(0\)/ }))
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('marks one or all messages read, and keeps the read ones under the Read tab', async () => {
  const marked: unknown[] = []
  const message = (id: string, minutesAgo: number, read: boolean) => ({ id, at: Date.now() - minutesAgo * 60_000, key: id.toUpperCase(), text: `note ${id}`, url: null, read })
  let messages = [message('a', 1, false), message('b', 2, false), message('c', 3, false), message('d', 4, true)]
  const newestUnreadAfterA = messages[1].at
  const host = mockHost({
    requests: {
      'inbox.list': () => withMessages(messages),
      'inbox.read': (input) => {
        marked.push(input)
        const ids = new Set((input as { ids: string[] }).ids)
        messages = messages.map((m) => (ids.has(m.id) ? { ...m, read: true } : m))
        return { ok: true }
      },
      'inbox.readAll': (input) => {
        marked.push(input)
        const { through } = input as { through: number }
        messages = messages.map((m) => (m.at <= through ? { ...m, read: true } : m))
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    const tabs = () => view.findAll({ type: 'Tab' }).map((e) => e.label)
    assert.ok(view.find({ type: 'Collapsible', label: 'Messages (3)' }))
    assert.ok(view.find({ type: 'Text', text: 'Last 7 days' }))
    assert.deepEqual(tabs(), ['Unread (3)', 'Read (1)'])
    assert.equal(view.findAll({ text: 'Mark read' }).length, 3)

    // Mark all read sits in the tab bar of Unread only
    await view.select({ type: 'Tabs' }, 'read')
    assert.ok(view.find({ text: /^D note d/ }))
    assert.equal(view.find({ text: /^A note a/ }), null)
    assert.equal(view.find({ text: 'Mark all read' }), null)
    await view.select({ type: 'Tabs' }, 'unread')
    assert.ok(view.find({ text: 'Mark all read' }))

    await view.press({ text: 'Mark read' })
    assert.deepEqual(marked, [{ ids: ['a'] }])
    assert.ok(view.find({ text: /^Messages \(2\)/ }))
    assert.deepEqual(tabs(), ['Unread (2)', 'Read (2)'])

    // the newest unread one bounds it: messages behind Show more go too, ones that arrive later do not
    await view.press({ text: 'Mark all read' })
    assert.deepEqual(marked[1], { through: newestUnreadAfterA })
    assert.ok(view.find({ text: /^Messages \(0\)/ }))
    assert.ok(view.find({ text: 'No unread messages' }))
    assert.deepEqual(tabs(), ['Unread (0)', 'Read (4)'])
    assert.equal(view.find({ text: 'Mark all read' }), null)
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('a message counts as read once its link opened, and a link Orca refuses says why', async () => {
  const marked: unknown[] = []
  const message = (id: string, url: string) => ({ id, at: Date.now() - 60_000, key: id.toUpperCase(), text: `note ${id}`, url, read: false })
  const host = mockHost({
    results: {
      'shell.openExternal': ({ url }: { url: string }) => {
        if (!url.startsWith('https:')) throw hostError('invalid_params')
        return { opened: true }
      }
    },
    requests: {
      'inbox.list': () => withMessages([message('web', 'https://ci/1'), message('file', 'file:///etc/hosts')]),
      'inbox.read': (input) => {
        marked.push(input)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    const [web, file] = view.findAll({ type: 'Button', text: 'Open link' })
    await view.press(web)
    assert.deepEqual(marked, [{ ids: ['web'] }])
    await view.press(file)
    assert.deepEqual(marked, [{ ids: ['web'] }])
    assert.ok(view.find({ text: /^Could not open the link: / }))
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('with messages kept until marked read, an opened link leaves the message unread', async () => {
  const marked: unknown[] = []
  const host = mockHost({
    results: { 'shell.openExternal': () => ({ opened: true }) },
    requests: {
      'inbox.list': () => ({ ...inbox('en', false), keepMessagesUntilRead: true }),
      'inbox.read': (input) => {
        marked.push(input)
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    await view.press({ type: 'Button', text: 'Open link' })
    assert.equal(host.callsOf('shell.openExternal').length, 1)
    assert.deepEqual(marked, [])
    await view.press({ text: 'Mark read' })
    assert.deepEqual(marked, [{ ids: ['m1'] }])
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }
})

test('an ask kept after the agent resolved it says so before the time', async () => {
  const kept = (language: Inbox['language']): Inbox => {
    const data = inbox(language)
    return { ...data, waiting: data.waiting.map((w) => ({ ...w, resumed: true })) }
  }
  for (const [language, label, tip] of [
    ['en', /^Agent resumed · /, 'Take it off this list; the agent already went on'],
    ['zh-CN', /^agent 已继续 · /, '从列表里移除；agent 已经继续了']
  ] as const) {
    const view = await mount(panel, { host: mockHost({ requests: { 'inbox.list': () => kept(language) } }) })
    try {
      assert.ok(view.find({ type: 'Text', text: label }))
      assert.equal(view.find({ type: 'Button', text: language === 'en' ? 'Mark handled' : '标记已处理' })?.props.tooltip, tip)
      assert.deepEqual(view.errors, [])
    } finally {
      await view.unmount()
    }
  }
  const plain = await mount(panel, { host: mockHost({ requests: { 'inbox.list': () => inbox('en') } }) })
  try {
    assert.equal(plain.find({ type: 'Text', text: /^Agent resumed/ }), null)
  } finally {
    await plain.unmount()
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
    terminal: null,
    resumed: false
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
  // Recommended points, with badges of their own, hidden
  let current: Inbox = {
    ...inbox('en', false),
    showRecommendations: false,
    points: [point('build', 'notify', 'the build failed'), point('design', 'ask', 'a design decision')]
  }
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

test('Add a point, Align, Edit and Remove start an agent with a prompt, and say when no workspace is selected', async () => {
  const launched: string[] = []
  const point = { id: 'build-failed', kind: 'notify' as const, key: 'BUILD', when: 'the build failed', wiredIn: 'build.sh' }
  const host = mockHost({
    requests: {
      'inbox.list': () => ({ ...inbox('en', false), points: [point] }),
      'inbox.launch': (input) => {
        launched.push((input as { prompt: string }).prompt)
        return launched.length < 5 ? { ok: true } : { ok: false, error: 'no-workspace' }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    await view.toggle({ type: 'Collapsible', label: 'Wired points (1)' })
    await view.press({ text: 'Add a point' })
    await view.press({ text: 'Align' })
    await view.press({ text: 'Edit' })
    await view.press({ text: 'Remove' })
    assert.deepEqual(launched, [
      'Read /h/.config/agent-inbox/agent-guide.md and add one Agent Inbox point to my workflow: ask me what should send, wire it where it belongs, and record it with agent-inbox point add.',
      'Read /h/.config/agent-inbox/agent-guide.md and align my Agent Inbox points: compare the recorded points with the agent-inbox calls in my workflow, show me the differences and the point add and point remove commands that fix the records, and run them once I agree. Change no workflow files.',
      'Read /h/.config/agent-inbox/agent-guide.md and change the Agent Inbox point build-failed (notify, key BUILD; the build failed; wired in build.sh): find its call in my workflow, show it to me and ask me how to change it, such as when it sends, its key, its message or where it is wired. Then change the call and record it again with agent-inbox point add build-failed.',
      'Read /h/.config/agent-inbox/agent-guide.md and remove the Agent Inbox point build-failed (the build failed; wired in build.sh): take its call out of my workflow and run agent-inbox point remove build-failed.'
    ])
    // the worker reads the board, then gives the agent up to a minute to start: past the 30 s default
    const launches = host.callsOf('plugin.request').filter((call: { name: string }) => call.name === 'inbox.launch')
    assert.deepEqual(launches.map((call: { timeoutMs?: number }) => call.timeoutMs), [120_000, 120_000, 120_000, 120_000])
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

test('a recommended point is added with one press and then shows under Wired points, where Remove stops it', async () => {
  const requests: [string, unknown][] = []
  let points: Inbox['points'] = []
  const recorded = { id: 'builtin.ask-question', kind: 'ask' as const, key: '<ticket or folder>', when: 'An agent asks you with AskUserQuestion; it goes once you answer', wiredIn: 'the Agent Inbox plugin' }
  const host = mockHost({
    requests: {
      'inbox.list': () => ({ ...inbox('en', false), points }),
      'inbox.addRecommended': (input) => {
        requests.push(['add', input])
        points = [recorded]
        return { ok: true }
      },
      'inbox.removeRecommended': (input) => {
        requests.push(['remove', input])
        points = []
        return { ok: true }
      },
      'inbox.launch': (input) => {
        requests.push(['launch', input])
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  try {
    // after Wired points, open, with the link to the discussions where people share theirs
    assert.ok(view.find({ type: 'Collapsible', label: 'Recommended points (1)' }))
    assert.ok(view.find({ type: 'Text', text: 'Picked from what people wire' }))
    assert.ok(view.find({ text: /^See the points others wire, and share yours: / }))
    assert.equal(
      view.find({ type: 'Link', text: 'GitHub Discussions' })?.props.href,
      'https://github.com/felix-lj-ct/orca-agent-inbox/discussions/categories/recommended-points'
    )
    assert.ok(view.find({ text: 'Agent questions wait on you' }))
    assert.equal(view.find({ text: 'Remove' }), null)

    await view.press({ text: 'Add this point' })
    assert.deepEqual(requests, [['add', { id: 'builtin.ask-question' }]])
    assert.ok(view.find({ type: 'Collapsible', label: 'Recommended points (0)' }))
    assert.ok(view.find({ text: 'You have added every recommended point.' }))
    // Wired points opened on the record, in the panel's words
    assert.equal(view.persisted.plugin.pointsOpen, true)
    assert.ok(view.find({ text: 'An agent asks you with AskUserQuestion; it goes once you answer' }))
    assert.ok(view.find({ text: 'key <ticket or folder> · the Agent Inbox plugin' }))

    // the plugin wires it as it is: no Edit, and Remove takes it out without an agent
    assert.equal(view.find({ text: 'Edit' }), null)
    await view.press({ text: 'Remove' })
    assert.deepEqual(requests.slice(1), [['remove', { id: 'builtin.ask-question' }]])
    assert.ok(view.find({ type: 'Collapsible', label: 'Recommended points (1)' }))
    assert.deepEqual(view.errors, [])
    assert.deepEqual(view.refusals, [])
  } finally {
    await view.unmount()
  }
})

test('the settings hide Recommended points, while an added one stays under Wired points; Chinese names it in Chinese', async () => {
  const recorded = { id: 'builtin.ask-question', kind: 'ask' as const, key: '<ticket or folder>', when: 'An agent asks you with AskUserQuestion; it goes once you answer', wiredIn: 'the Agent Inbox plugin' }
  const host = mockHost({ requests: { 'inbox.list': () => ({ ...inbox('zh-CN', false), points: [recorded], showRecommendations: false }) } })
  const view = await mount(panel, { host, persisted: { plugin: { pointsOpen: true } } })
  try {
    assert.equal(view.find({ type: 'Collapsible', label: /^推荐接入点/ }), null)
    assert.ok(view.find({ type: 'Collapsible', label: '接入点（1）' }))
    assert.ok(view.find({ text: 'agent 用 AskUserQuestion 向你提问；回答后自动移走' }))
    assert.ok(view.find({ text: 'key：<ticket 或目录名> · Agent Inbox 插件' }))
    assert.ok(view.find({ type: 'Button', text: '新增' }))
    assert.equal(view.find({ type: 'Button', text: '修改' }), null)
    assert.deepEqual(view.errors, [])
  } finally {
    await view.unmount()
  }

  const shown = await mount(panel, { host: mockHost({ requests: { 'inbox.list': () => inbox('zh-CN', false) } }) })
  try {
    assert.ok(shown.find({ type: 'Collapsible', label: '推荐接入点（1）' }))
    assert.ok(shown.find({ text: 'agent 提问时等你处理' }))
    assert.ok(shown.find({ type: 'Button', text: '接入' }))
    assert.ok(shown.find({ type: 'Link', text: 'GitHub 讨论区' }))
  } finally {
    await shown.unmount()
  }
})
