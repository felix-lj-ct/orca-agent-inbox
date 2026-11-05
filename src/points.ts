// The points of the person's workflow that send to Agent Inbox, which `agent-inbox point add` records beside
// the log (inbox.jsonl keeps them in inbox.points.jsonl), one JSON object per line:
//   {"v":1,"id":"cleanup-failed","kind":"notify","key":"cleanup","when":"the nightly cleanup failed",
//    "wiredIn":"automation Cleanup, precheck cleanup.sh","ts":"2026-11-05T02:21:53Z"}
// Only the CLI writes the file; a later line with the same id replaces an earlier one.
import type { WiredPoint } from './protocol'

export const pointsPath = (logPath: string) => `${logPath.replace(/\.jsonl$/, '')}.points.jsonl`

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** The recorded points in file order; blank, broken and incomplete lines are skipped. */
export function parsePoints(content: string): WiredPoint[] {
  const points = new Map<string, WiredPoint>()
  for (const raw of content.split('\n')) {
    if (!raw.trim()) continue
    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (typeof line !== 'object' || line === null) continue
    const point = { id: text(line.id), kind: line.kind, key: text(line.key), when: text(line.when), wiredIn: text(line.wiredIn) }
    if (!point.id || (point.kind !== 'ask' && point.kind !== 'notify') || !point.when) continue
    points.delete(point.id)
    points.set(point.id, point as WiredPoint)
  }
  return [...points.values()]
}
