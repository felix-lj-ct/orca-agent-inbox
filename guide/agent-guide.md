---
name: agent-inbox
description: Use when you are about to stop because you need the person's decision, approval or help; when something happened that they should know about (a long job finished or failed, a report was posted, a credential expired); or when they ask to wire Agent Inbox messages into their workflow. Explains how to send with the agent-inbox CLI, and how to find the points in a workflow that should send.
---

# Agent Inbox: guide for agents

Agent Inbox is an Orca plugin. It shows the person one sidebar panel with two lists:

- **Waiting on you**: workspaces in the board's waiting column (default `in-review`), each with what the agent
  needs, a button that switches to the terminal of the agent that asked, and **Mark handled**. The board card
  also gets the reason as its comment and the unread dot.
- **Messages**: recent events from agents and scripts, kept for the retention window set in the plugin
  settings (default 7 days). The person can hide a message.

Everything goes through one CLI:

```sh
~/.config/agent-inbox/bin/agent-inbox where     # the settings in use; fails if the plugin never ran
```

If that file does not exist, the plugin is not installed or not enabled. Tell the person instead of
working around it.

## Sending

| Command | Use it when | The person sees |
| --- | --- | --- |
| `agent-inbox ask <key> "<message>" [<url>]` | You stop and cannot go on without the person | A card under Waiting on you; the workspace moves to the waiting column with an unread dot |
| `agent-inbox resolve <key>` | You got the answer and go on | The card goes; the workspace moves back to the resolved column (default `in-progress`), unless the person already moved it |
| `agent-inbox notify <key> "<message>" [<url>]` | Something happened that the person should know; nothing waits | A line under Messages |
| `agent-inbox test` | Drill inside a workspace; undo with `agent-inbox resolve TEST` | A TEST card |

`ask`, `resolve` and `test` act on the workspace of the current directory (its Git top level); pass
`--worktree <path>` right after the command when you run elsewhere. `notify` works anywhere. Exit codes: 0
done, 2 usage, 3 the orca CLI is missing or Orca is not running, 4 the log stayed locked.

Rules:

1. **Ask only when you stop.** Run `ask` just before you end your turn with the question. Start your final
   message with `[needs you] <key>` so it also stands out in the terminal and in Orca's phone push.
2. **Resolve when you go on.** Run `resolve` as soon as you continue after the answer. It is safe to repeat:
   if the person already pressed Mark handled, it changes nothing on the board.
3. **Notify for events, not for progress.** Finishing a turn is not an event: Orca already shows agent states.
   Do not notify for progress updates, routine successes nobody acts on, or anything the person already gets
   through another channel they read.
4. **One line that says what to do.** At most about 120 characters: what you need, or what happened and what
   the person should do about it. The key names the work (ticket id, job name, workspace), so the person can
   tell messages apart. Add the URL when there is a page to open.
5. **One channel.** Do not also send a desktop notification, mail or chat message for the same event.
6. **No secrets.** The log is a plain text file.
7. **If the CLI fails, say so in your reply** with its error. Do not retry in a loop.

## Wiring a workflow

Do this when the person asks to set up, review or extend Agent Inbox for their workflow. The goal: every
point where the workflow needs the person, or should tell them something, sends exactly one message, and
nothing else sends.

### 1. Learn the workflow

Read what exists before you ask: agent instruction files (`CLAUDE.md`, `AGENTS.md`, rules folders), scripts,
scheduled jobs (`orca automations list`, crontab, CI schedules), CI pipelines, Makefiles and READMEs. Then ask
the person only for the gaps: the stages from start to done, who or what runs each one (the person, an
agent, a script, a schedule), and where they wait or get surprised today.

### 2. Find the nodes

Walk every stage and look for these kinds of points:

| Kind | Examples | Send |
| --- | --- | --- |
| Decision gate | a design choice the agent should not make alone, an unclear requirement, conflicting instructions | `ask` |
| Approval before an irreversible or outward action | deploy to production, delete data, publish, post a comment or mail, force-push, spend money | `ask` |
| A resource only the person has | an expired login or session cookie, 2FA, a missing credential or permission, a device | `ask` from an agent; `notify` with the fix from a script |
| Retries used up | an automatic fix loop used its rounds, a flaky job failed again | `ask` |
| A conflict the agent cannot judge | a merge conflict across someone else's change, contradicting review comments | `ask` |
| A long job ended | a build, test suite, migration or batch run finished or failed | `notify` |
| A handoff happened | a pull request opened, a report posted, a ticket moved to the next team | `notify`, with the link |
| A scheduled job did something | a cleanup deleted records, a nightly check found a problem | `notify`, only when it did something or failed |
| A precondition is missing | an input file, a config value or an environment is not there | `notify`, once per occurrence |

To choose between `ask` and `notify`: if the work stops until the person acts, it is an `ask`. An `ask` needs
an Orca workspace, so a script outside one sends a `notify` that says what to do.

### 3. Propose a trigger table

Show the person a short table and let them confirm or cut rows. Fewer messages are better: every message
should be one the person acts on or wants to know.

| Node | Command | Key | Message | Called by | Repeats |
| --- | --- | --- | --- | --- | --- |
| Design decision during implementation | `ask` | ticket id | `<question in one line>` | agent instructions | once per question |
| Nightly cleanup failed | `notify` | `cleanup` | `cleanup failed: <reason>; run <command> to retry` | cleanup script | once until it works again |

### 4. Wire each node in the one place that owns it

- **Agent behavior** goes into the instructions file the workflow already uses. Add this section, adapted:

  ```markdown
  ## Stopping for me
  When you cannot go on without my decision, approval or help:
  1. Run `~/.config/agent-inbox/bin/agent-inbox ask <KEY> "<what you need, one line>"` in the workspace.
  2. Start your reply with `[needs you] <KEY>`, ask the question, and stop.
  3. When I answer and you go on, run `~/.config/agent-inbox/bin/agent-inbox resolve <KEY>`.
  Finishing normally is not a stop: send nothing.
  ```

- **Scripts** call the CLI once, at the node. A failed notification must not fail the job:

  ```sh
  ~/.config/agent-inbox/bin/agent-inbox notify nightly-build "build failed: 3 tests red" "$BUILD_URL" || true
  ```

  ```python
  import os, subprocess
  subprocess.run([os.path.expanduser("~/.config/agent-inbox/bin/agent-inbox"), "notify",
                  "import", f"import finished: {count} rows"], check=False)
  ```

- **Scheduled jobs** report a lasting condition once, not on every run: keep a marker file while the condition
  holds (for example an expired credential), and notify again only after it cleared and came back.
- **One sender per node.** If the workflow already has its own notify wrapper, point that wrapper at
  `agent-inbox` instead of calling the CLI from many places.
- Prefer explicit calls at the node over hooks that fire on every agent event; those flood the inbox.

### 5. Drill

1. Inside a workspace, run `agent-inbox test`: a TEST card appears under Waiting on you, and the workspace moves
   to the waiting column. Press **Go to agent**, then run `agent-inbox resolve TEST` (or press Mark handled).
2. Run `agent-inbox notify DRILL "drill message"`: it appears under Messages. Hide it.
3. Trigger one real node if that is cheap and safe, and check the message reads well.

### 6. Write the table down

Put the final trigger table where the workflow is documented (its README or the instructions file), so the
next change to the workflow updates it too.

## Reference

- **Settings** (Orca → Settings → Plugins → Agent Inbox): log file, retention days, waiting column, resolved
  column, language, orca command. The CLI reads them from `~/.config/agent-inbox/config.env`, which the plugin
  rewrites on every change. The environment variables `AGENT_INBOX_LOG`, `AGENT_INBOX_WAITING`,
  `AGENT_INBOX_RESUME` and `AGENT_INBOX_ORCA` override it for one call.
- **Log**: JSON Lines at the configured path, one object per line with `v`, `ts` (UTC ISO 8601), `kind`
  (`notify`, `ask` or `resolve`), `key`, `message`, `url`, `worktree` and `terminal`. Read it if you need to;
  write only through the CLI, which appends under the lock the plugin prunes under.
- **A workspace has one waiting state.** A later `ask` in the same workspace replaces the reason, and one
  `resolve` clears it.
- **Troubleshooting.** Exit 3: start Orca, or set "orca command" in the settings. "no workspace": run inside
  the workspace or pass `--worktree`. A card does not show: the waiting column id must match a board column
  (`orca worktree show --worktree active --json` prints the workspace's `workspaceStatus`). A message does not
  show: it is older than the retention window, or the person hid it.
