// The plugin's settings, read once and shared by the worker and the CLI. The worker writes them to
// ~/.config/agent-inbox/config.json, which the CLI reads, so agents and scripts follow a change in
// Settings without being told.
import { join } from 'node:path'

export type Language = 'auto' | 'en' | 'zh-CN'

export interface InboxConfig {
  /** Absolute path of the JSON Lines log. */
  logPath: string
  retentionDays: number
  /** Board status id an ask moves the workspace to. */
  waitingStatus: string
  /** Board status id a resolve moves the workspace back to. */
  resumeStatus: string
  /** An ask stays under Waiting on you until the person marks it handled, whatever the agent and the board do. */
  keepAsksUntilHandled: boolean
  /** Opening a message's link leaves it unread. */
  keepMessagesUntilRead: boolean
  language: Language
  /** Path of the orca CLI, '' to look for it. */
  orcaCli: string
}

/** The manifest's defaults, for a host that does not fill them in. */
export const DEFAULTS: InboxConfig = {
  logPath: '~/.local/state/agent-inbox/inbox.jsonl',
  retentionDays: 7,
  waitingStatus: 'in-review',
  resumeStatus: 'in-progress',
  keepAsksUntilHandled: false,
  keepMessagesUntilRead: false,
  language: 'auto',
  orcaCli: ''
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
    retentionDays: Number.isInteger(days) && days >= 1 ? Math.min(days, 365) : DEFAULTS.retentionDays,
    waitingStatus: text(raw.waitingStatus, DEFAULTS.waitingStatus),
    resumeStatus: text(raw.resumeStatus, DEFAULTS.resumeStatus),
    keepAsksUntilHandled: raw.keepAsksUntilHandled === true,
    keepMessagesUntilRead: raw.keepMessagesUntilRead === true,
    language,
    orcaCli: expandHome(text(raw.orcaCli, ''), home)
  }
}

/** config.json: the settings the CLI needs. */
export function renderConfig(config: InboxConfig): string {
  const settings = {
    note: 'Written by the Agent Inbox Orca plugin from its settings; edits here are overwritten.',
    log: config.logPath,
    waiting: config.waitingStatus,
    resume: config.resumeStatus,
    orca: config.orcaCli
  }
  return `${JSON.stringify(settings, null, 2)}\n`
}
