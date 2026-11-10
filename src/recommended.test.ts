// The recommended points and what an AskUserQuestion call sends: the key, the reason, and that RECOMMENDED.md, the
// CLI and both languages name every point the panel offers.
import { assert, test } from 'orca/testing'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strings } from './i18n'
import { questionKey, questionReason } from './question'
import { ASK_QUESTION, RECOMMENDED, recommended } from './recommended'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('the key is a ticket id in the branch or the folder name, else the folder name', () => {
  assert.equal(questionKey('/work/MD-18876-fix', 'main'), 'MD-18876')
  assert.equal(questionKey('/work/app', 'feature/PROJ-12-login'), 'PROJ-12')
  // the branch first
  assert.equal(questionKey('/work/AB-1', 'CD-2'), 'CD-2')
  assert.equal(questionKey('/work/orca-agent-inbox', 'recommended-points'), 'orca-agent-inbox')
  assert.equal(questionKey('/work/app', 'md-123-lower'), 'app')
})

test('the reason is the first question on one line, cut to 100 characters, with how many were asked', () => {
  const ask = (...texts: string[]) => ({ questions: texts.map((question) => ({ question, header: 'h', options: [], multiSelect: false })) })
  assert.equal(questionReason(ask('  Which   column?\n')), 'Which column?')
  assert.equal(questionReason(ask('Which column?', 'Which colour?', 'Ship it?')), 'Which column? (1/3)')
  const long = questionReason(ask('x'.repeat(150)))
  assert.equal(long, `${'x'.repeat(99)}…`)
  // never inside a character that takes two UTF-16 units
  assert.equal(questionReason(ask(`${'x'.repeat(98)}😀😀😀`)), `${'x'.repeat(98)}😀…`)
  assert.equal(questionReason(ask('')), 'The agent waits for your answer')
  assert.equal(questionReason(undefined), 'The agent waits for your answer')
  assert.equal(questionReason({ questions: 'odd' }), 'The agent waits for your answer')
})

test('RECOMMENDED.md, the CLI and both languages name every recommended point', () => {
  const doc = readFileSync(join(ROOT, 'RECOMMENDED.md'), 'utf8')
  const cli = readFileSync(join(ROOT, 'cli', 'agent-inbox.mjs'), 'utf8')
  assert.ok(cli.includes(`const ASK_QUESTION = '${ASK_QUESTION}'`))
  assert.equal(recommended(ASK_QUESTION)?.kind, 'ask')
  assert.equal(recommended('build'), undefined)
  for (const point of RECOMMENDED) {
    // ids are what `point add` takes
    assert.match(point.id, /^builtin\.[A-Za-z0-9._-]+$/)
    assert.ok(doc.includes(`\`${point.id}\``), `RECOMMENDED.md names ${point.id}`)
    for (const language of ['en', 'zh-CN'] as const) {
      const text = strings(language, 'en').recommendedPoints[point.id]
      assert.ok(text?.title && text.description && text.when && text.key && text.wiredIn, `${language} names ${point.id}`)
    }
  }
})
