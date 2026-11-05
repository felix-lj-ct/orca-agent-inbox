import { assert, test } from 'orca/testing'
import { keepLines, openAsks, parseLine, parseLog, recentMessages } from './log'

const DAY = 24 * 3600 * 1000
const NOW = Date.parse('2026-11-20T12:00:00Z')
const line = (daysAgo: number, kind: string, key: string, worktree: string | null = null, message = `${kind} ${key}`) =>
  JSON.stringify({ v: 1, ts: new Date(NOW - daysAgo * DAY).toISOString(), kind, key, message, url: null, worktree, terminal: null })

test('parses a line and rejects broken, foreign and unknown-kind lines', () => {
  const entry = parseLine(line(1, 'ask', 'P-1', '/w'))
  assert.equal(entry?.kind, 'ask')
  assert.equal(entry?.worktree, '/w')
  assert.equal(entry?.at, NOW - DAY)
  assert.equal(parseLine('2026-11-04 15:44\tinfo\tP-1\told tab format\t'), null)
  assert.equal(parseLine('{"ts":"2026-11-04T00:00:00Z","kind":"shout","key":"P-1"}'), null)
  assert.equal(parseLine('{"ts":"not a date","kind":"ask","key":"P-1"}'), null)
  assert.equal(parseLine('   '), null)
  assert.equal(parseLog(`${line(1, 'notify', 'A')}\nbroken\n\n${line(0, 'notify', 'B')}\n`).length, 2)
})

test('a resolve closes the asks before it in the same workspace only', () => {
  const entries = parseLog(
    [line(5, 'ask', 'A', '/a'), line(4, 'ask', 'B', '/b'), line(3, 'resolve', 'A', '/a'), line(2, 'ask', 'B2', '/b')].join('\n')
  )
  const open = openAsks(entries)
  assert.deepEqual([...open.keys()], ['/b'])
  assert.equal(open.get('/b')?.key, 'B2')
})

test('prune keeps the window and every open ask however old, and drops broken lines', () => {
  const lines = [
    line(30, 'ask', 'OLD-OPEN', '/open'),
    line(20, 'ask', 'OLD-CLOSED', '/closed'),
    line(19, 'resolve', 'OLD-CLOSED', '/closed'),
    line(10, 'notify', 'OLD'),
    'not json',
    line(6, 'notify', 'RECENT'),
    line(0.5, 'ask', 'NEW', '/new')
  ]
  const kept = keepLines(lines, NOW, 7).map((raw) => JSON.parse(raw).key)
  assert.deepEqual(kept, ['OLD-OPEN', 'RECENT', 'NEW'])
  // a shorter window keeps less, an open ask still stays
  assert.deepEqual(
    keepLines(lines, NOW, 1).map((raw) => JSON.parse(raw).key),
    ['OLD-OPEN', 'NEW']
  )
})

test('messages are the notify lines of the window, newest first, without the dismissed ones', () => {
  const entries = parseLog([line(9, 'notify', 'GONE'), line(3, 'notify', 'A'), line(2, 'ask', 'X', '/x'), line(1, 'notify', 'B')].join('\n'))
  const all = recentMessages(entries, NOW, 7, new Set())
  assert.deepEqual(all.map((e) => e.key), ['B', 'A'])
  const dismissed = new Set([`${all[0].at}|B|notify B`])
  assert.deepEqual(recentMessages(entries, NOW, 7, dismissed).map((e) => e.key), ['A'])
})
