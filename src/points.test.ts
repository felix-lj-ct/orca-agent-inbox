import { assert, test } from 'orca/testing'
import { parsePoints, pointsPath } from './points'

const line = (id: string, kind: string, when: string, extra: object = {}) =>
  JSON.stringify({ v: 1, id, kind, key: 'K', when, wiredIn: 'CLAUDE.md', ts: '2026-11-05T00:00:00Z', ...extra })

test('the points sit beside the log', () => {
  assert.equal(pointsPath('/s/inbox.jsonl'), '/s/inbox.points.jsonl')
  assert.equal(pointsPath('/s/inbox.log'), '/s/inbox.log.points.jsonl')
})

test('parses points in file order, a later line with the same id replacing the earlier one', () => {
  const text = [
    line('a', 'ask', 'first'),
    'broken',
    line('b', 'notify', 'second'),
    line('c', 'shout', 'unknown kind'),
    line('', 'ask', 'no id'),
    line('d', 'notify', ''),
    '',
    line('a', 'ask', 'replaced')
  ].join('\n')
  assert.deepEqual(parsePoints(text), [
    { id: 'b', kind: 'notify', key: 'K', when: 'second', wiredIn: 'CLAUDE.md' },
    { id: 'a', kind: 'ask', key: 'K', when: 'replaced', wiredIn: 'CLAUDE.md' }
  ])
})
