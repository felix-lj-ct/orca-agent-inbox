// The plugin's settings, read once and shared by the worker and the CLI. The worker writes them to
// ~/.config/agent-inbox/config.json, which the CLI reads, so agents and scripts follow a change in
// Settings without being told.
import { join } from 'node:path'

export type Language = 'auto' | 'en' | 'zh-CN'

/** Messages are kept at most this many days, whatever the settings ask for. */
export const MAX_RETENTION_DAYS = 30

/** Board status id an ask moves the workspace to. */
export const WAITING_STATUS = 'in-review'

/** Board status id a resolve moves the workspace back to. */
export const RESUME_STATUS = 'in-progress'

export interface InboxConfig {
  /** Absolute path of the JSON Lines log. */
  logPath: string
  /** At least 1, at most MAX_RETENTION_DAYS. */
  retentionDays: number
  /** An ask stays under Waiting on you until the person marks it handled, whatever the agent and the board do. */
  keepAsksUntilHandled: boolean
  /** Opening a message's link leaves it unread. */
  keepMessagesUntilRead: boolean
  /** Per point id, minutes after arrival at which a message it sent counts as read; a point not listed is never. */
  autoReadMinutes: Record<string, number>
  /** The panel shows Recommended points. */
  showRecommendations: boolean
  /** The panel shows the point search above Messages and above Wired points. */
  showPointSearch: boolean
  language: Language
  /** Path of the orca CLI, '' to look for it. */
  orcaCli: string
}

/** The manifest's defaults, for a host that does not fill them in. */
export const DEFAULTS: InboxConfig = {
  logPath: '~/.local/state/agent-inbox/inbox.jsonl',
  retentionDays: 7,
  keepAsksUntilHandled: false,
  keepMessagesUntilRead: false,
  autoReadMinutes: {},
  showRecommendations: true,
  showPointSearch: true,
  language: 'auto',
  orcaCli: ''
}

/**
 * The autoReadMinutes setting: point ids and counts of minutes, as `id: 30`. Entries go one per line or comma
 * separated, as in `nightly-e2e: 5, qa-report: 30`. Blank entries and entries of another shape are skipped, and
 * 0 or less never marks: a message is not read the moment it arrives.
 */
export function parseAutoRead(value: unknown): Record<string, number> {
  if (typeof value !== 'string') return {}
  const minutes: Record<string, number> = {}
  for (const part of value.split(/[\r\n,;]+/)) {
    const match = /^\s*([^\s:,;]+)\s*[:=]\s*(\d+)\s*$/.exec(part)
    if (match === null) continue
    const count = Number(match[2])
    if (count > 0) minutes[match[1]] = count
  }
  return minutes
}

/** Where the worker installs what agents and scripts use: bin/, lib/agent-inbox.mjs, config.json, agent-guide.md, cli.md. */
export const configDir = (home: string) => join(home, '.config', 'agent-inbox')

/** ~ and what starts with ~/ (or ~\, as written on Windows) are in the home folder. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  return /^~[\\/]/.test(path) ? join(home, path.slice(2)) : path
}

const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback

/** Settings as Orca returns them (possibly partial or of the wrong type) to a usable config. */
export function readConfig(raw: Record<string, unknown>, home: string): InboxConfig {
  const days = Number(raw.retentionDays)
  const language = raw.language === 'en' || raw.language === 'zh-CN' ? raw.language : 'auto'
  return {
    logPath: expandHome(text(raw.logPath, DEFAULTS.logPath), home),
    retentionDays: Number.isInteger(days) && days >= 1 ? Math.min(days, MAX_RETENTION_DAYS) : DEFAULTS.retentionDays,
    keepAsksUntilHandled: raw.keepAsksUntilHandled === true,
    keepMessagesUntilRead: raw.keepMessagesUntilRead === true,
    autoReadMinutes: parseAutoRead(raw.autoReadMinutes),
    showRecommendations: raw.showRecommendations !== false,
    showPointSearch: raw.showPointSearch !== false,
    language,
    orcaCli: expandHome(text(raw.orcaCli, ''), home)
  }
}

/** config.json: the settings the CLI needs. */
export function renderConfig(config: InboxConfig): string {
  const settings = {
    note: 'Written by the Agent Inbox Orca plugin from its settings; edits here are overwritten.',
    log: config.logPath,
    waiting: WAITING_STATUS,
    resume: RESUME_STATUS,
    orca: config.orcaCli
  }
  return `${JSON.stringify(settings, null, 2)}\n`
}
