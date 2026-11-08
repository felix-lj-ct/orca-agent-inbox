import { assert, test } from 'orca/testing'
import { currentId, keepLines, messageId, openAsks, parseLine, parseLog, pathKey, recentMessages } from './log'

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
  assert.deepEqual([...open.keys()], [pathKey('/b')])
  assert.equal(open.get(pathKey('/b'))?.key, 'B2')
})

test('a Windows workspace path is the same with either slash and in any case', () => {
  assert.equal(pathKey('C:/Work/App', 'win32'), pathKey('c:\\work\\app', 'win32'))
  assert.equal(pathKey('C:\\work\\app\\', 'win32'), pathKey('C:\\work\\app', 'win32'))
  assert.equal(pathKey('C:\\', 'win32'), 'c:\\')
  assert.notEqual(pathKey('C:\\work\\app', 'win32'), pathKey('C:\\work\\app2', 'win32'))
  // elsewhere a path is itself: case matters, and a backslash is part of a name
  assert.notEqual(pathKey('/Work/App', 'linux'), pathKey('/work/app', 'linux'))
  assert.equal(pathKey('/w/a\\b', 'darwin'), '/w/a\\b')
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

test('messages are the notify lines of the window, newest first', () => {
  const entries = parseLog([line(9, 'notify', 'GONE'), line(3, 'notify', 'A'), line(2, 'ask', 'X', '/x'), line(1, 'notify', 'B')].join('\n'))
  assert.deepEqual(recentMessages(entries, NOW, 7).map((e) => e.key), ['B', 'A'])
})

test('a message id is short, and an id stored before 0.1.2 becomes the same one', () => {
  const entry = parseLine(line(1, 'notify', 'BUILD', null, 'nightly build failed | twice'))
  assert.ok(entry)
  const id = messageId(entry)
  assert.match(id, /^[0-9a-f]{16}$/)
  assert.equal(currentId(`${entry.at}|BUILD|nightly build failed | twice`), id)
  assert.equal(currentId(id), id)
})
