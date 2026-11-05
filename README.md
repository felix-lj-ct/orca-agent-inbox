# Agent Inbox

An [Orca](https://onorca.dev) plugin that shows, in one sidebar panel, what your agents and scripts wait on
you for:

- **Waiting on you**: workspaces an agent parked in a board column because it needs your decision, approval
  or help, with the reason. **Go to agent** switches to the terminal that asked; **Mark handled** moves the
  workspace back.
- **Messages**: what happened that you should know (a long job failed, a report was posted, a credential
  expired), kept for as many days as you choose.

A status bar item counts the workspaces waiting on you.

Agents and scripts send with one CLI, `agent-inbox`, at the points of your workflow that need you. The plugin
ships a guide written for agents (`guide/agent-guide.md`) that walks your agent through finding those points
with you and wiring them.

## Install

From Orca: Settings → Plugins, find **Agent Inbox** in the community catalog, or add this repository's Git URL.
Enable it and approve its access (see [What it can do](#what-it-can-do)).

When it starts, the plugin installs into `~/.config/agent-inbox/`:

| File | What it is |
| --- | --- |
| `bin/agent-inbox` | The CLI agents and scripts call |
| `config.env` | The plugin settings the CLI reads; rewritten on every settings change |
| `agent-guide.md` | The guide for agents |

The plugin rewrites these files whenever it starts and whenever you change its settings, so do not edit them.

## Send

```sh
agent-inbox notify <key> "<message>" [<url>]                 # a line under Messages
agent-inbox ask [--worktree <path>] <key> "<message>" [<url>] # the workspace waits on you
agent-inbox resolve [--worktree <path>] <key>                 # it no longer does
agent-inbox test                                              # drill; undo with: agent-inbox resolve TEST
agent-inbox where                                             # the settings in use
```

`<key>` names the work: a ticket id, a job name. `ask` moves the workspace of the current directory (or
`--worktree`) to the waiting column, with `<key>: <message>` as its comment and the unread dot, and records the
terminal it ran in, so **Go to agent** lands on the agent that asked. `resolve` moves the workspace back to the
resolved column only if it is still waiting, so a workspace you have moved on stays where you put it.

## Wire your workflow

Give your agent this prompt:

> Read ~/.config/agent-inbox/agent-guide.md and help me add Agent Inbox messages to my workflow.

The agent reads your instructions files, scripts and scheduled jobs, proposes a short table of trigger points
(decision gates, approvals before irreversible actions, expired credentials, used-up retries, finished or
failed long jobs, handoffs), wires the ones you keep, and runs a drill.

The guide is also a Claude Code skill. To have Claude Code load it by itself when it needs you:

```sh
mkdir -p ~/.claude/skills/agent-inbox
ln -sf ~/.config/agent-inbox/agent-guide.md ~/.claude/skills/agent-inbox/SKILL.md
```

## Settings

Orca → Settings → Plugins → Agent Inbox.

| Setting | Default | What it does |
| --- | --- | --- |
| Log file | `~/.local/state/agent-inbox/inbox.jsonl` | Where the CLI writes and the panel reads |
| Keep messages for (days) | 7 | Lines older than this are removed when Orca starts, every hour and when settings change. A request still waiting on you is kept however old it is |
| Waiting column | `in-review` | Board status id that `ask` moves the workspace to; the panel lists every workspace in it |
| Resolved column | `in-progress` | Board status id that `resolve` and Mark handled move it back to |
| Language | Same as Orca | English or Simplified Chinese |
| orca command | found automatically | Path to the orca CLI, if the plugin cannot find it |

## How it works

- **The board is the source of truth for what waits.** Dragging a card out of the waiting column by hand is as
  good as Mark handled; a card you drag in shows up with its comment. A workspace has one waiting state: a
  later `ask` replaces the reason, one `resolve` clears it.
- **The log** is JSON Lines, one object per line: `v`, `ts` (UTC ISO 8601), `kind` (`notify`, `ask` or
  `resolve`), `key`, `message`, `url`, `worktree`, `terminal`. Tools may read it; write it only through the CLI.
- **Cleanup.** The worker prunes the log under a lock folder (`<log>.lock`) that the CLI also takes to append,
  so no line is lost while it rewrites the file. A lock left by a killed process is broken after a few seconds.
- **The orca CLI** reads and moves the board, because the plugin host API has no board methods yet.

## What it can do

The plugin runs as a `trusted-worker`: a Node.js process with your user's access. It uses that to:

- run the `orca` CLI to read the board and terminals, switch terminals and move workspaces between columns;
- write `~/.config/agent-inbox/` and the log file, and remove log lines past the retention window.

It asks Orca for `storage:own` (hidden messages), `settings:own` (its settings), and `workspace:read` and
`agent:read` (to refresh when agents and workspaces change). It makes no network requests.

Requirements: Orca 1.4.248 or later; macOS or Linux (the CLI is a bash script).

## Develop

```sh
orca plugin test .       # unit tests, the CLI against a fake orca, the worker and the panel
orca plugin check .      # renders the panel with the real worker
orca plugin validate .
orca plugin dev load . --approve <fingerprint>   # Orca prints the fingerprint
```

There is no build step: Orca transpiles the TypeScript when it loads. `src/protocol.ts` types the panel and
worker contract; `src/log.ts`, `src/config.ts` and `src/board.ts` are pure; `src/store.ts` owns the files.

## License

MIT
