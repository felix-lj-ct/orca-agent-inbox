// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Language } from './config'

/** A workspace in the waiting column: `agent-inbox ask` (or the person) put it there. */
export interface WaitingItem {
  path: string
  /** The key the ask named, else the workspace name. */
  key: string
  repo: string
  /** What the agent needs, null when nothing says. */
  reason: string | null
  /** When it asked, null when the log has no open ask for the workspace. */
  since: number | null
  url: string | null
  /** Terminal handle of the agent that asked, else of any terminal in the workspace. */
  terminal: string | null
}

/** An `agent-inbox notify` line: something happened, nothing waits. */
export interface InboxMessage {
  id: string
  at: number
  key: string
  text: string
  url: string | null
}

/** Where agents and people find the CLI and the guide, for the panel's setup section. */
export interface Setup {
  cli: string
  guide: string
  log: string
}

export interface Inbox {
  waiting: WaitingItem[]
  messages: InboxMessage[]
  retentionDays: number
  language: Language
  setup: Setup
  /** Reading the board or installing the CLI failed; messages still come from the log. */
  error: string | null
}

export interface ActionResult {
  ok: boolean
  error?: string
}

declare module 'orca' {
  interface PluginRequests {
    'inbox.list': { output: Inbox }
    /** Switches Orca to the terminal of the agent that asked. */
    'inbox.open': { input: { path: string; terminal: string | null }; output: ActionResult }
    /** `agent-inbox resolve`: back to the resolved column, comment cleared. */
    'inbox.resolve': { input: { path: string; key: string }; output: ActionResult }
    'inbox.dismiss': { input: { id: string }; output: ActionResult }
  }
  interface PluginPanelEvents {
    /** The log or the settings changed. */
    'inbox.changed': { at: number }
  }
}
