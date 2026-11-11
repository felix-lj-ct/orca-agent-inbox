import { assert, test } from 'orca/testing'
import { PREVIEW_CHARS, preview } from './preview'

test('a short text shows whole; a long one shows whole lines up to the limits, then an ellipsis', () => {
  assert.equal(preview('one line'), null)
  assert.equal(preview('1\n2\n3\n4\n5\n6'), null)
  assert.equal(preview('1\n2\n3\n4\n5\n6\n7'), '1\n2\n3\n4\n5\n6 …')
  const wide = 'w'.repeat(200)
  assert.equal(preview(`${wide}\n${wide}\n${wide}`), `${wide} …`)
  // a first line past the limit is cut inside it
  assert.equal(preview('x'.repeat(PREVIEW_CHARS + 50)), `${'x'.repeat(PREVIEW_CHARS)} …`)
})

test('a code block the cut leaves open is closed', () => {
  assert.equal(preview('Failed:\n```\na\nb\nc\nd\ne\nf\n```'), 'Failed:\n```\na\nb\nc\nd\n```\n\n…')
})
