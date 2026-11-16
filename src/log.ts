// The log the agent-inbox CLI appends to: one JSON object per line,
//   {"v":1,"ts":"2026-11-05T02:21:53Z","kind":"ask","key":"PROJ-12","message":"...","url":null,
//    "worktree":"/path/to/workspace","terminal":"term_...","point":null}
// kind is notify (a message), ask (the workspace waits on the person) or resolve (it no longer does).
// point is the recorded point that sent a notify, when its call named one (`--point <id>`).
// Asks and resolves always carry the workspace path; a workspace has one waiting state, so a resolve
// closes every ask before it in the same workspace.
import { createHash } from 'node:crypto'
import { win32 } from 'node:path'

export type EntryKind = 'notify' | 'ask' | 'resolve'

export interface Entry {
  at: number
  kind: EntryKind
  key: string
  message: string
  url: string | null
  worktree: string | null
  terminal: string | null
  point: string | null
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
    terminal: optional(line.terminal),
    point: optional(line.point)
  }
}

export function parseLog(text: string): Entry[] {
  return text.split('\n').flatMap((raw) => parseLine(raw) ?? [])
}

/**
 * A workspace path as a map key. Windows paths name the same folder with either slash, in any case and with or
 * without a separator at the end, and Git there reports C:/a/b where Orca has C:\a\b.
 */
export function pathKey(path: string, platform: string = process.platform): string {
  if (platform !== 'win32') return path
  const normal = win32.normalize(path)
  // a drive's root keeps its separator
  return (normal.length > 3 ? normal.replace(/\\+$/, '') : normal).toLowerCase()
}

/** Per workspace path (see pathKey), its last ask that no later resolve closed. */
export function openAsks(entries: Entry[]): Map<string, Entry> {
  const open = new Map<string, Entry>()
  for (const entry of entries) {
    if (!entry.worktree) continue
    if (entry.kind === 'ask') open.set(pathKey(entry.worktree), entry)
    else if (entry.kind === 'resolve') open.delete(pathKey(entry.worktree))
  }
  return open
}

/**
 * With asks kept until handled: when the setting went on, and per workspace path the id (messageId) of the ask
 * the person last marked handled.
 */
export interface Hold {
  since: number
  handled: Record<string, string>
}

/**
 * Per workspace path (see pathKey), its last ask while asks are kept until handled: open or not, unless a resolve
 * closed it before the setting went on or the person marked it handled.
 */
export function heldAsks(entries: Entry[], hold: Hold): Map<string, Entry> {
  const held = new Map<string, Entry>()
  for (const entry of entries) {
    if (!entry.worktree) continue
    if (entry.kind === 'ask') held.set(pathKey(entry.worktree), entry)
    else if (entry.kind === 'resolve' && entry.at < hold.since) held.delete(pathKey(entry.worktree))
  }
  for (const [path, ask] of held) if (hold.handled[path] === messageId(ask)) held.delete(path)
  return held
}

/**
 * The lines a prune keeps, in order: the lines inside the retention window. Older lines go, an open ask
 * included: nothing in the log outlives the window. Broken lines go too.
 */
export function keepLines(lines: string[], now: number, retentionDays: number): string[] {
  const from = now - retentionDays * DAY
  return lines.filter((raw) => {
    const entry = parseLine(raw)
    return entry !== null && entry.at >= from
  })
}

const hashId = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** A short stable id of a text, such as the comment the CLI writes for an ask. It keeps no text. */
export const textId = (text: string) => hashId(text)

/** The comment `agent-inbox ask` writes on the board: `<key>: <first line, without heading marks>`. */
export function askComment(entry: Entry): string {
  const line = entry.message.split('\n').find((text) => text.trim()) ?? ''
  return `${entry.key}: ${line.replace(/^\s*#+\s+/, '').trim()}`
}

/** Short, so Mark read can send many in one request (a request input stops at 64 KiB). It also names a handled ask. */
export const messageId = (entry: Entry) => hashId(`${entry.at}|${entry.key}|${entry.message}`)

/** Up to 0.1.1 an id was the text messageId now hashes; a stored one of those becomes the id of today. */
export const currentId = (id: string) => (id.includes('|') ? hashId(id) : id)

/** Notify entries inside the retention window, newest first. */
export function recentMessages(entries: Entry[], now: number, retentionDays: number): Entry[] {
  const from = now - retentionDays * DAY
  return entries.filter((e) => e.kind === 'notify' && e.at >= from).reverse()
}

/**
 * Ids of the messages whose point is set to become read on its own (the autoReadMinutes setting): the ones whose
 * minutes have passed since they arrived.
 */
export function autoRead(entries: Entry[], minutes: Record<string, number>, now: number): string[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== 'notify' || entry.point === null || !Object.hasOwn(minutes, entry.point)) return []
    return now - entry.at >= minutes[entry.point] * 60_000 ? [messageId(entry)] : []
  })
}
