// The recommended points: what the panel offers under Recommended points, as RECOMMENDED.md lists them under
// "In Agent Inbox". The plugin wires each one itself. Adding one records it with `agent-inbox point add`, and
// the record is the switch: the point works while it is recorded, and removing the record stops it. People share
// the points they wire in the repository's Discussions, under Recommended points, and each release picks some of
// them for RECOMMENDED.md and for the panel.
import { REPO, type WiredPoint } from './protocol'

/** The Discussions category where people share the points they wire and read those of others. */
export const DISCUSSIONS_URL = `https://github.com/${REPO}/discussions/categories/recommended-points`

/**
 * A question an agent asks with the AskUserQuestion tool waits under Waiting on you until it is answered. The CLI
 * names it too, for the brief of `agent-inbox hook`.
 */
export const ASK_QUESTION = 'builtin.ask-question'

/** Each one as `point add` records it, in English; the panel names it in its own language (src/i18n.ts). */
export const RECOMMENDED: WiredPoint[] = [
  {
    id: ASK_QUESTION,
    kind: 'ask',
    key: '<ticket or folder>',
    when: 'An agent asks you with AskUserQuestion; it goes once you answer',
    wiredIn: 'the Agent Inbox plugin'
  }
]

export const recommended = (id: unknown): WiredPoint | undefined => RECOMMENDED.find((p) => p.id === id)
