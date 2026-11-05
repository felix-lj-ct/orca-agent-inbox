// The plugin's settings, read once and shared by the worker and the CLI. The worker writes them to
// ~/.config/agent-inbox/config.env, which the CLI sources, so agents and scripts follow a change in
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
  language: 'auto',
  orcaCli: ''
}

/** Where the worker installs what agents and scripts use: bin/agent-inbox, config.env, agent-guide.md. */
export const configDir = (home: string) => join(home, '.config', 'agent-inbox')

export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  return path.startsWith('~/') ? join(home, path.slice(2)) : path
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
    language,
    orcaCli: expandHome(text(raw.orcaCli, ''), home)
  }
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

/** config.env: the settings the CLI needs, as shell assignments. */
export function renderEnv(config: InboxConfig): string {
  return [
    '# Written by the Agent Inbox Orca plugin from its settings; edits here are overwritten.',
    `AGENT_INBOX_LOG=${shellQuote(config.logPath)}`,
    `AGENT_INBOX_WAITING=${shellQuote(config.waitingStatus)}`,
    `AGENT_INBOX_RESUME=${shellQuote(config.resumeStatus)}`,
    `AGENT_INBOX_ORCA=${shellQuote(config.orcaCli)}`,
    ''
  ].join('\n')
}
