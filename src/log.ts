// The log the agent-inbox CLI appends to: one JSON object per line,
//   {"v":1,"ts":"2026-11-05T02:21:53Z","kind":"ask","key":"PROJ-12","message":"...","url":null,
//    "worktree":"/path/to/workspace","terminal":"term_..."}
// kind is notify (a message), ask (the workspace waits on the person) or resolve (it no longer does).
// Asks and resolves always carry the workspace path; a workspace has one waiting state, so a resolve
// closes every ask before it in the same workspace.

export type EntryKind = 'notify' | 'ask' | 'resolve'

export interface Entry {
  at: number
  kind: EntryKind
  key: string
  message: string
  url: string | null
  worktree: string | null
  terminal: string | null
}

const KINDS = new Set<string>(['notify', 'ask', 'resolve'])
const DAY = 24 * 3600 * 1000

const optional = (value: unknown) => (typeof value === 'string' && value ? value : null)

/** One log line, or null for a blank, foreign or broken line. */
export function parseLine(raw: string): Entry | null {
  if (!raw.trim()) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const line = value as Record<string, unknown>
  const at = typeof line.ts === 'string' ? Date.parse(line.ts) : Number.NaN
  if (Number.isNaN(at) || typeof line.kind !== 'string' || !KINDS.has(line.kind) || typeof line.key !== 'string') return null
  return {
    at,
    kind: line.kind as EntryKind,
    key: line.key,
    message: typeof line.message === 'string' ? line.message : '',
    url: optional(line.url),
    worktree: optional(line.worktree),
    terminal: optional(line.terminal)
  }
}

export function parseLog(text: string): Entry[] {
  return text.split('\n').flatMap((raw) => parseLine(raw) ?? [])
}

/** Per workspace path, its last ask that no later resolve closed. */
export function openAsks(entries: Entry[]): Map<string, Entry> {
  const open = new Map<string, Entry>()
  for (const entry of entries) {
    if (!entry.worktree) continue
    if (entry.kind === 'ask') open.set(entry.worktree, entry)
    else if (entry.kind === 'resolve') open.delete(entry.worktree)
  }
  return open
}

/**
 * The lines a prune keeps, in order: every line inside the retention window, plus the open ask of each
 * workspace however old (the panel still shows when and why it asked). Broken lines go.
 */
export function keepLines(lines: string[], now: number, retentionDays: number): string[] {
  const from = now - retentionDays * DAY
  const parsed = lines.map((raw) => ({ raw, entry: parseLine(raw) }))
  const stillOpen = new Set(openAsks(parsed.flatMap((p) => p.entry ?? [])).values())
  return parsed.filter(({ entry }) => entry !== null && (entry.at >= from || stillOpen.has(entry))).map((p) => p.raw)
}

export const messageId = (entry: Entry) => `${entry.at}|${entry.key}|${entry.message}`

/** Notify entries inside the retention window, newest first, without the dismissed ones. */
export function recentMessages(entries: Entry[], now: number, retentionDays: number, dismissed: Set<string>): Entry[] {
  const from = now - retentionDays * DAY
  return entries.filter((e) => e.kind === 'notify' && e.at >= from && !dismissed.has(messageId(e))).reverse()
}
