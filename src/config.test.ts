import { assert, test } from 'orca/testing'
import { execFileSync } from 'node:child_process'
import { DEFAULTS, readConfig, renderEnv } from './config'

const HOME = '/home/someone'

test('fills defaults and expands ~', () => {
  assert.deepEqual(readConfig({}, HOME), {
    ...DEFAULTS,
    logPath: '/home/someone/.local/state/agent-inbox/inbox.jsonl'
  })
  const config = readConfig({ logPath: ' ~/logs/inbox.jsonl ', orcaCli: '~/bin/orca', waitingStatus: 'blocked', language: 'zh-CN' }, HOME)
  assert.equal(config.logPath, '/home/someone/logs/inbox.jsonl')
  assert.equal(config.orcaCli, '/home/someone/bin/orca')
  assert.equal(config.waitingStatus, 'blocked')
  assert.equal(config.language, 'zh-CN')
})

test('falls back on values of the wrong type or range', () => {
  const config = readConfig({ retentionDays: 0, language: 'fr', logPath: 42, waitingStatus: '  ' }, HOME)
  assert.equal(config.retentionDays, 7)
  assert.equal(config.language, 'auto')
  assert.equal(config.logPath, '/home/someone/.local/state/agent-inbox/inbox.jsonl')
  assert.equal(config.waitingStatus, 'in-review')
  assert.equal(readConfig({ retentionDays: 1000 }, HOME).retentionDays, 365)
  assert.equal(readConfig({ retentionDays: 2.5 }, HOME).retentionDays, 7)
})

test('config.env reads back in a shell exactly, quotes included', () => {
  const config = readConfig({ logPath: "/tmp/it's here/$HOME `x`/inbox.jsonl", waitingStatus: 'needs-me' }, HOME)
  const out = execFileSync('/bin/bash', ['-c', `${renderEnv(config)}\nprintf '%s\\n' "$AGENT_INBOX_LOG" "$AGENT_INBOX_WAITING"`], {
    encoding: 'utf8'
  })
  assert.equal(out, "/tmp/it's here/$HOME `x`/inbox.jsonl\nneeds-me\n")
})
