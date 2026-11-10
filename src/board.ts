// The Orca board as `orca worktree ps --json` and `orca terminal list --json` report it, turned into
// the panel's waiting list. The board is the source of truth for what waits: dragging a card out of the
// waiting column by hand is as good as resolving it, and one dragged in shows up with its comment. With asks
// kept until handled, a held ask (see heldAsks) stays listed wherever its card is, until the person marks it.
import { type Entry, pathKey } from './log'
import type { WaitingItem } from './protocol'

/** orca CLI JSON, read field by field */
type Raw = any

/** The comment `agent-inbox ask` writes is "<key>: <message>". */
function reasonFromComment(comment: string, key: string): string {
  return comment.startsWith(`${key}: `) ? comment.slice(key.length + 2) : comment
}

export function waitingItems(
  worktrees: Raw[],
  terminals: Raw[],
  open: Map<string, Entry>,
  waitingStatus: string,
  held: Map<string, Entry> = new Map()
): WaitingItem[] {
  const handles = new Set<string>()
  const handleByPane = new Map<string, string>()
  const firstHandleByPath = new Map<string, string>()
  for (const t of terminals) {
    handles.add(t.handle)
    handleByPane.set(`${t.tabId}:${t.leafId}`, t.handle)
    const path = pathKey(String(t.worktreePath ?? ''))
    if (!firstHandleByPath.has(path)) firstHandleByPath.set(path, t.handle)
  }
  return worktrees
    .filter((w) => (w.workspaceStatus === waitingStatus || held.has(pathKey(String(w.path)))) && !w.isArchived)
    .map((w): WaitingItem => {
      const path = pathKey(String(w.path))
      const ask = held.get(path) ?? open.get(path)
      const key = ask?.key ?? String(w.displayName ?? '')
      const comment = String(w.comment ?? '').trim()
      // the terminal that asked, else the newest top-level agent's, else any terminal of the workspace
      const agents = (w.agents ?? []).filter((a: Raw) => !a.parentPaneKey)
      const newest = agents.sort((a: Raw, b: Raw) => (b.stateStartedAt ?? 0) - (a.stateStartedAt ?? 0))[0]
      const terminal =
        (ask?.terminal && handles.has(ask.terminal) ? ask.terminal : null) ??
        (newest && handleByPane.get(newest.paneKey)) ??
        firstHandleByPath.get(path) ??
        null
      return {
        path: w.path,
        key,
        repo: String(w.repo ?? ''),
        reason: ask?.message || reasonFromComment(comment, key) || null,
        since: ask?.at ?? null,
        url: ask?.url ?? null,
        terminal,
        // a resolve closed it: the log has it open no more
        resumed: held.has(path) && !open.has(path)
      }
    })
    .sort((a, b) => (b.since ?? 0) - (a.since ?? 0))
}
