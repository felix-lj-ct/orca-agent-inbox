import { assert, test } from 'orca/testing'
import { waitingItems } from './board'
import { openAsks, parseLog } from './log'

const ask = (key: string, worktree: string, terminal: string | null, ts = '2026-11-05T02:00:00Z') =>
  JSON.stringify({ v: 1, ts, kind: 'ask', key, message: `${key} needs a decision`, url: 'https://x/1', worktree, terminal })

const worktrees = [
  { path: '/w/asked', displayName: 'asked', repo: 'app', workspaceStatus: 'in-review', comment: 'P-1: P-1 needs a decision', agents: [] },
  {
    path: '/w/dragged',
    displayName: 'dragged',
    repo: 'app',
    workspaceStatus: 'in-review',
    comment: 'look at the API diff',
    agents: [
      { paneKey: 'tab1:leafOld', stateStartedAt: 1 },
      { paneKey: 'tab1:leafNew', stateStartedAt: 5 },
      { paneKey: 'tab1:sub', stateStartedAt: 9, parentPaneKey: 'tab1:leafNew' }
    ]
  },
  { path: '/w/bare', displayName: 'bare', repo: 'app', workspaceStatus: 'in-review', comment: '', agents: [] },
  { path: '/w/working', displayName: 'working', repo: 'app', workspaceStatus: 'in-progress', comment: '', agents: [] },
  { path: '/w/archived', displayName: 'archived', repo: 'app', workspaceStatus: 'in-review', comment: '', isArchived: true }
]
const terminals = [
  { handle: 'term_asker', tabId: 't0', leafId: 'l0', worktreePath: '/w/asked' },
  { handle: 'term_old', tabId: 'tab1', leafId: 'leafOld', worktreePath: '/w/dragged' },
  { handle: 'term_new', tabId: 'tab1', leafId: 'leafNew', worktreePath: '/w/dragged' },
  { handle: 'term_sub', tabId: 'tab1', leafId: 'sub', worktreePath: '/w/dragged' }
]

test('lists the waiting column with the ask behind each card', () => {
  const open = openAsks(parseLog(ask('P-1', '/w/asked', 'term_asker')))
  const items = waitingItems(worktrees, terminals, open, 'in-review')
  assert.deepEqual(
    items.map((i) => [i.key, i.reason, i.terminal]),
    [
      ['P-1', 'P-1 needs a decision', 'term_asker'],
      // dragged in by hand: its comment is the reason, the newest top-level agent the terminal
      ['dragged', 'look at the API diff', 'term_new'],
      ['bare', null, null]
    ]
  )
  assert.equal(items[0].url, 'https://x/1')
  assert.equal(items[0].since, Date.parse('2026-11-05T02:00:00Z'))
})

test('a closed terminal falls back to the workspace terminals, and the column is configurable', () => {
  const open = openAsks(parseLog(ask('P-1', '/w/asked', 'term_gone')))
  assert.equal(waitingItems(worktrees, terminals, open, 'in-review')[0].terminal, 'term_asker')
  assert.deepEqual(
    waitingItems(worktrees, terminals, open, 'in-progress').map((i) => i.key),
    ['working']
  )
})
