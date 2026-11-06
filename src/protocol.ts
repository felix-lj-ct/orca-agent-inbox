// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Language } from './config'

/** The repository the panel's footer asks to star. */
export const REPO = 'felix-lj-ct/orca-agent-inbox'

/** Messages each tab of the panel shows at first, and how many more each Show more adds. */
export const MESSAGE_PAGE = 20

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
  read: boolean
}

/** A point of the person's workflow that sends here, as `agent-inbox point add` recorded it. */
export interface WiredPoint {
  id: string
  /** ask: it shows under Waiting on you; notify: under Messages. */
  kind: 'ask' | 'notify'
  /** The key it sends, or a placeholder such as <ticket> when the key varies. */
  key: string
  when: string
  /** The file, script or automation that sends. */
  wiredIn: string
}

/** Where agents and people find the CLI and the guide, for the panel's setup task. */
export interface Setup {
  cli: string
  guide: string
  log: string
}

export interface Inbox {
  waiting: WaitingItem[]
  /** The newest unread messages, then the newest read ones, as many of each as inbox.list asked for. */
  messages: InboxMessage[]
  /** Every unread and every read message inside the retention window, shown or not. */
  unreadCount: number
  readCount: number
  points: WiredPoint[]
  retentionDays: number
  language: Language
  setup: Setup
  /** First start without a log: the setup task waits on the person until they mark it handled. */
  setupPending: boolean
  /** Reading the board or installing the CLI failed; messages still come from the log. */
  error: string | null
}

export interface ActionResult {
  ok: boolean
  error?: string
}

declare module 'orca' {
  interface PluginRequests {
    /**
     * How many messages of each tab to send. A request answer stops at 1 MiB, so the worker sends at most that
     * many, cuts long texts and stops early when they would not fit.
     */
    'inbox.list': { input: { unread: number; read: number }; output: Inbox }
    /** Switches Orca to the terminal of the agent that asked. */
    'inbox.open': { input: { path: string; terminal: string | null }; output: ActionResult }
    /** `agent-inbox resolve`: back to the resolved column, comment cleared. */
    'inbox.resolve': { input: { path: string; key: string }; output: ActionResult }
    /** Marks messages read; they move to the read history until the retention window drops them. */
    'inbox.read': { input: { ids: string[] }; output: ActionResult }
    /** Marks every unread message up to `through`, the newest the panel showed, read: shown or not. */
    'inbox.readAll': { input: { through: number }; output: ActionResult }
    /** The setup task is handled; it does not come back. */
    'inbox.setupDone': { output: ActionResult }
    /** Puts text on the system clipboard, which a panel cannot reach. Fails with `no-clipboard`. */
    'inbox.copy': { input: { text: string }; output: ActionResult }
    /**
     * Starts Orca's default agent with the prompt in the workspace selected in Orca and shows it, for Wired
     * points' Add a point, Align and Remove. Fails with `no-workspace` when none is selected.
     */
    'inbox.launch': { input: { prompt: string }; output: ActionResult }
    /** Stars REPO with the person's GitHub account through their gh CLI; fails when gh is missing or signed out. */
    'inbox.star': { output: ActionResult }
  }
  interface PluginPanelEvents {
    /** The log or the settings changed. */
    'inbox.changed': { at: number }
  }
}
