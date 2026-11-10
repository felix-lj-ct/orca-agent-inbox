// What an agent's AskUserQuestion call puts under Waiting on you once the person added the recommended point
// (src/recommended.ts): the key and the reason the agent would give `agent-inbox ask` itself.
import { basename } from 'node:path'

/** The panel's reason is about one line. */
const MAX_REASON = 100

/** A ticket id such as PROJ-12 in the branch or the folder name, else the folder name. */
export function questionKey(path: string, branch: string): string {
  const folder = basename(path)
  return /[A-Z][A-Z0-9]+-[0-9]+/.exec(`${branch} ${folder}`)?.[0] ?? folder
}

/**
 * The first question on one line, cut to 100 characters (never inside a character), with (1/n) after it when the
 * agent asks n at once. The tool's input is {questions: [{question, header, options, ...}]}.
 */
export function questionReason(input: unknown): string {
  const questions = typeof input === 'object' && input !== null ? (input as { questions?: unknown }).questions : undefined
  const list = Array.isArray(questions) ? questions : []
  const first = list[0] as { question?: unknown } | undefined
  const chars = Array.from(String(first?.question ?? '').split(/\s+/).filter(Boolean).join(' '))
  const text = chars.length > MAX_REASON ? `${chars.slice(0, MAX_REASON - 1).join('')}…` : chars.join('')
  const reason = text || 'The agent waits for your answer'
  return list.length > 1 ? `${reason} (1/${list.length})` : reason
}
