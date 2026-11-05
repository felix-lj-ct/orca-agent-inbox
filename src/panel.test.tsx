// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import type { Inbox } from './protocol'

const inbox = (language: Inbox['language'], waiting = true): Inbox => ({
  waiting: waiting
    ? [{ path: '/w/a', key: 'P-1', repo: 'app', reason: 'pick A or B', since: Date.now() - 60_000, url: null, terminal: 'term_1' }]
    : [],
  messages: [{ id: 'm1', at: Date.now() - 3_600_000, key: 'BUILD', text: 'nightly build failed', url: 'https://ci/1' }],
  retentionDays: 7,
  language,
  setup: { cli: '/h/.config/agent-inbox/bin/agent-inbox', guide: '/h/.config/agent-inbox/agent-guide.md', log: '/h/inbox.jsonl' },
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

    await view.press({ text: 'Mark handled' })
    assert.deepEqual(resolved, [{ path: '/w/a', key: 'P-1' }])
    assert.ok(view.find({ text: 'Nothing is waiting on you' }))
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
    assert.ok(view.find({ text: '等你处理' }))
    assert.ok(view.find({ text: /^消息（1）/ }))
    await view.press({ text: '去处理' })
    assert.ok(view.find({ text: '这个工作区没有打开的终端，请从侧边栏打开它' }))
  } finally {
    await view.unmount()
  }
})
