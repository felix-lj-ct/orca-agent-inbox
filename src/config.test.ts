import { assert, test } from 'orca/testing'
import { join } from 'node:path'
import { DEFAULTS, expandHome, readConfig, renderConfig } from './config'

const HOME = '/home/someone'

test('fills defaults and expands ~', () => {
  assert.deepEqual(readConfig({}, HOME), {
    ...DEFAULTS,
    logPath: join(HOME, '.local/state/agent-inbox/inbox.jsonl')
  })
  const config = readConfig({ logPath: ' ~/logs/inbox.jsonl ', orcaCli: '~/bin/orca', waitingStatus: 'blocked', language: 'zh-CN' }, HOME)
  assert.equal(config.logPath, join(HOME, 'logs/inbox.jsonl'))
  assert.equal(config.orcaCli, join(HOME, 'bin/orca'))
  assert.equal(config.waitingStatus, 'blocked')
  assert.equal(config.language, 'zh-CN')
})

test('~ is the home folder written with either slash, and only at the start', () => {
  assert.equal(expandHome('~', HOME), HOME)
  assert.equal(expandHome('~\\logs\\inbox.jsonl', HOME), join(HOME, 'logs\\inbox.jsonl'))
  assert.equal(expandHome('~/logs', HOME), join(HOME, 'logs'))
  assert.equal(expandHome('~logs', HOME), '~logs')
  assert.equal(expandHome('/srv/~/logs', HOME), '/srv/~/logs')
})

test('falls back on values of the wrong type or range', () => {
  const config = readConfig({ retentionDays: 0, language: 'fr', logPath: 42, waitingStatus: '  ' }, HOME)
  assert.equal(config.retentionDays, 7)
  assert.equal(config.language, 'auto')
  assert.equal(config.logPath, join(HOME, '.local/state/agent-inbox/inbox.jsonl'))
  assert.equal(config.waitingStatus, 'in-review')
  assert.equal(readConfig({ retentionDays: 1000 }, HOME).retentionDays, 365)
  assert.equal(readConfig({ retentionDays: 2.5 }, HOME).retentionDays, 7)
})

test('asks and messages are kept until marked only when the settings say true', () => {
  const on = readConfig({ keepAsksUntilHandled: true, keepMessagesUntilRead: true }, HOME)
  assert.deepEqual([on.keepAsksUntilHandled, on.keepMessagesUntilRead], [true, true])
  const odd = readConfig({ keepAsksUntilHandled: 'true', keepMessagesUntilRead: 1 }, HOME)
  assert.deepEqual([odd.keepAsksUntilHandled, odd.keepMessagesUntilRead], [false, false])
})

test('config.json holds what the CLI reads, quotes and backslashes included', () => {
  const config = readConfig({ logPath: "C:\\Users\\it's \"here\"\\inbox.jsonl", waitingStatus: 'needs-me', orcaCli: '/opt/orca' }, HOME)
  const read = JSON.parse(renderConfig(config))
  assert.deepEqual([read.log, read.waiting, read.resume, read.orca], ["C:\\Users\\it's \"here\"\\inbox.jsonl", 'needs-me', 'in-progress', '/opt/orca'])
})
