import { assert, test } from 'orca/testing'
import { currentId, heldAsks, keepLines, messageId, openAsks, parseLine, parseLog, pathKey, recentMessages } from './log'

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

test('held asks: the last of each workspace, resolved or not, unless resolved before the hold or marked handled', () => {
  const entries = parseLog(
    [
      line(9, 'ask', 'BEFORE', '/before'),
      line(8, 'resolve', 'BEFORE', '/before'),
      line(7, 'ask', 'OPEN-AT-HOLD', '/open'),
      line(4, 'ask', 'RESOLVED', '/resolved'),
      line(3, 'resolve', 'RESOLVED', '/resolved'),
      line(3, 'ask', 'OLD', '/twice'),
      line(2, 'ask', 'NEW', '/twice'),
      line(2, 'ask', 'HANDLED', '/handled'),
      line(1, 'notify', 'NOTE', '/note')
    ].join('\n')
  )
  const handled = entries.find((e) => e.key === 'HANDLED')
  assert.ok(handled)
  const held = heldAsks(entries, { since: NOW - 5 * DAY, handled: { [pathKey('/handled')]: messageId(handled) } })
  assert.deepEqual([...held.values()].map((e) => e.key), ['OPEN-AT-HOLD', 'RESOLVED', 'NEW'])
  // a new ask after the handled one is held again
  const again = parseLog([line(2, 'ask', 'HANDLED', '/handled'), line(1, 'ask', 'AGAIN', '/handled')].join('\n'))
  assert.deepEqual([...heldAsks(again, { since: NOW - 5 * DAY, handled: { [pathKey('/handled')]: messageId(handled) } }).values()].map((e) => e.key), ['AGAIN'])
})

test('with a hold, prune keeps each held ask however old, with the resolves after it', () => {
  const lines = [
    line(30, 'ask', 'HELD', '/held'),
    line(29, 'notify', 'NOTE', '/held'),
    line(28, 'resolve', 'HELD', '/held'),
    line(20, 'ask', 'DONE', '/done'),
    line(19, 'resolve', 'DONE', '/done')
  ]
  const done = parseLine(lines[3])
  assert.ok(done)
  const hold = { since: NOW - 40 * DAY, handled: { [pathKey('/done')]: messageId(done) } }
  assert.deepEqual(keepLines(lines, NOW, 7, hold).map((raw) => JSON.parse(raw).message), ['ask HELD', 'resolve HELD'])
  assert.deepEqual(keepLines(lines, NOW, 7), [])
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
