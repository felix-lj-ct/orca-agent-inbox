---
name: agent-inbox
description: Use when the person asks where their workflow should ask them or tell them something through Agent Inbox, asks to set up, review or extend Agent Inbox for their workflow, asks to add or remove one Agent Inbox point, or asks to align the recorded points with the workflow. Explains how to tell the person's agents about the inbox through a session-start hook so that they judge what to send, how to find the points of scripts and Orca automations that should send, and how to wire each one, in a hook or a script before an instruction file or a prompt. For a whole workflow it produces a proposal and changes no files; for one point it makes the change once the person agrees; to align, it changes only the records, once the person agrees.
---

# Agent Inbox: find where a workflow should send

Agent Inbox is an Orca plugin. Its sidebar panel shows the person three lists:

- **Waiting on you**: workspaces that an agent moved to the board's waiting column with `agent-inbox ask`,
  each with the reason, a button that goes to the terminal of the agent that asked, and a link when the agent
  gave one.
- **Messages**: lines sent with `agent-inbox notify`, each with a link when the sender gave one, kept for the
  retention window (default 7 days).
- **Wired points**: the points of the workflow that send, recorded with `agent-inbox point add`, so the
  person can see what may write to the inbox and where it is wired.

What the person asked decides your job:

- **Go through a workflow** (all of it, or one workflow by name): learn it, see how its agents get to know
  the inbox, find the points where its scripts and automations should ask the person or tell them
  something, and give them a proposal that says what to wire and how (sections 1 to 5). **Change no
  files.** The person reads the proposal, cuts rows, and applies it later or asks for it in a separate
  request.
- **Add one point, or remove the point `<id>`**: the panel's **Add a point** and **Remove** buttons start you
  with this request. Make that one change in the workflow and in the records, once the person agrees to it
  (section 6).
- **Align the points**: the panel's **Align** button starts you with this request. Compare the records with
  the calls in the workflow and fix the records, once the person agrees (section 7). **Change no workflow
  files.**

## The CLI

First read `~/.config/agent-inbox/cli.md`, the reference of the CLI: each command with its arguments, what the
person sees, where it runs, what a message and its link can hold, the exit codes, and how to call it in
PowerShell, cmd and WSL. This guide writes `agent-inbox` for `~/.config/agent-inbox/bin/agent-inbox`.

If the file is not there, the plugin is not installed or has not started yet; in WSL, the link to the Windows
folder can also be missing. Tell the person and stop. Then check that the CLI runs, the way `cli.md` gives for
your shell:

```sh
~/.config/agent-inbox/bin/agent-inbox where
```

If this fails, tell the person what it printed and stop.

## Agents judge; scripts are wired

An agent that knows the inbox is there can judge for itself what the person needs to decide or know. A
capable model judges this better than rules written for it in advance, and such rules can make it work
worse. So:

- **Agent sessions**: tell each agent about the inbox once, through a hook that runs when a session starts
  (section 2), and leave the rest to it. Do not list points for agent sessions, and do not write rules for
  when an agent should `ask` or `notify`.
- **Scripts, automation prechecks, scheduled jobs and CI**: no agent judges there. Find their points
  (section 3) and wire each one with a call (section 4).
- **A hook or a script first.** Propose lines in an instruction file (`CLAUDE.md`, `AGENTS.md`, rules) or in an
  automation prompt only when no hook or script can carry them, or when the person asks for them.

## 1. Learn the workflow

Read what exists before you ask:

- **The agents and their settings**: which agents the person runs in Orca (Orca's default agent, the agents
  of the automations), and their hooks: for Claude Code the `hooks` of `~/.claude/settings.json` and of the
  projects' `.claude/settings.json`; for another agent, its own hook settings.
- **Agent instruction files**: `CLAUDE.md`, `AGENTS.md`, rules folders, and the skills the workflow uses.
- **Scripts**: the scripts the workflow runs, Makefiles, READMEs.
- **Orca automations**: `orca automations list --json`. For each one note its name, schedule (`rrule`),
  whether it is enabled, `precheck.command`, `prompt`, and workspace (`workspaceMode`, `runContext.path`).
  Read the precheck script, and find what the prompt tells the agent to report. `orca automations runs --id
  <id>` shows how often it runs, skips and fails.
- **Other schedules and CI**: `crontab -l`, launchd agents, on Windows the Task Scheduler
  (`Get-ScheduledTask` in PowerShell, or `schtasks /query /fo list /v`), CI pipelines and their schedules.
- **What already notifies**: notify wrappers, hooks that send, desktop notifications (`osascript`,
  `terminal-notifier`, `notify-send`, PowerShell toasts such as BurntToast), mail, chat webhooks, Jira or PR
  comments the person reads.

If the person names one workflow, read and propose for that one only.

Find what is already wired: run `agent-inbox point list` for the recorded points, search those same places
for `agent-inbox` (an agent hook that runs `agent-inbox hook` included), and read the keys in the log
(`agent-inbox where` prints its path). Do not propose a point again that already sends, or the hook where it
is already in place. Use the same key names and the same notify wrapper as the points already wired. Compare
the records with what you found: a recorded point whose call is gone needs a `point remove`, and a call
without a record needs a `point add` (snippet D).

A record whose id starts with `builtin.` is a recommended point that the plugin wires itself: it has no call in
the workflow, and the person adds and removes it in the panel, under **Recommended points** and **Wired
points**. `builtin.ask-question` sends every question an agent asks with Claude Code's AskUserQuestion tool.
`RECOMMENDED.md` in the plugin's repository lists them, and the points other people wire.

Then ask the person only for the gaps: the stages from start to done, who or what runs each one (the person,
an agent, a script, an Orca automation), and where they wait or get surprised today.

## 2. Tell the agents

`agent-inbox hook` prints the brief: what the panel is, the `ask`, `resolve` and `notify` commands, and that
the agent judges what is worth sending. Run it in an Orca terminal to read it. Outside an Orca terminal it
prints nothing.

For each agent the person uses:

| The agent | Give it the brief like this |
| --- | --- |
| Claude Code | A `SessionStart` hook in `~/.claude/settings.json` that runs `agent-inbox hook` (snippet A). Every session then reads the brief when it starts, and again after `/clear` and compaction, in every workspace and in Orca automation runs |
| Another agent that has a hook which runs a command when a session starts and gives its output to the agent | The same command in that hook |
| An agent without such a hook | The brief, as `agent-inbox hook` prints it, in the agent's global instruction file (snippet C) |

Then:

- **Leave the judgment to the agent.** Propose no rules for when it should `ask` or `notify`. If the person
  wants one case sent every time, wire that case as section 4 says, in a hook on that event first.
- **An instruction file that already tells agents to send** (a section such as "Stopping for me") overlaps
  the brief. Propose to take out what the brief already says, once the hook is in place; keep what the
  section adds, such as the person's own cases.
- **Record the hook as two points** (snippet D): an `ask` and a `notify`, both wired in the hook.

## 3. Find the trigger points of scripts and automations

Walk every stage that runs without an agent's judgment: scripts, automation prechecks, scheduled jobs, CI,
and scripts that drive an agent in a loop. Look for these kinds of points:

| Kind | Examples | Send |
| --- | --- | --- |
| A resource only the person has | an expired login or session cookie, 2FA, a missing credential or permission, a device | `notify`, with the fix |
| Retries used up | an automatic fix loop used its rounds, a flaky job failed again | `ask` for the workspace that waits; else `notify` |
| A long job ended | a build, test suite, migration or batch run finished or failed | `notify` |
| A handoff happened | a pull request opened, a report posted, a ticket moved to the next team | `notify`, with the link |
| A scheduled job did something | a cleanup deleted records, a nightly check found a problem | `notify`, only when it did something or failed |
| A precondition is missing | an input file, a config value or an environment is not there | `notify`, once per occurrence |

To choose between them: if the work stops until the person acts, it is an `ask`. An `ask` needs an Orca
workspace that waits for the person, which a script names with `--worktree <path>`; with no such workspace, a
script sends a `notify` that says what to do.

Keep a point only if all of these are true:

- **The person acts on it or wants to know it.** Progress updates and routine successes are not points.
- **One channel.** If the person already gets it through a channel they read, propose to point that channel
  at `agent-inbox` or leave the point out. Never add a second message for the same event.
- **One line.** It fits in about 120 characters: what is needed, or what happened and what the person should
  do. Add the URL when there is a page to open (`cli.md` says which links open). No secrets: the log is a plain
  text file.
- **Once.** A lasting condition (an expired credential, a missing input) is sent once, not on every run.

Fewer points are better: every message should be one the person acts on or wants to know.

## 4. Choose how each point is wired

Wire each point in the one place that owns it, and only in places that exist today. If a point has no place
to send from (the person checks it by hand), list it under "Not wired" with the reason.

| The point is in | Wire it like this |
| --- | --- |
| A script | One CLI call at the point; a failed message must not fail the job (snippet B) |
| An Orca automation's precheck | A `notify` call in the precheck script (snippet B); see below |
| An Orca automation's prompt | Nothing, when the agent of the run gets the brief (section 2): it judges. A result that must reach the person every time: a call in a script the run already runs (snippet B). Lines in the prompt (snippet C) only when neither is possible, or the person asks for them |
| An agent event that the person wants sent every time (a question tool, a given command) | Claude Code's AskUserQuestion: the recommended point `builtin.ask-question`, which the person adds in the panel; no hook. Another event: a hook on that event that runs a small script, which reads the hook's input and calls the CLI; for Claude Code a `PreToolUse` or `PostToolUse` hook with a `matcher`. A line in the instruction file (snippet C) only when the agent has no such hook |
| A notify wrapper or channel the workflow already has | Point the wrapper at `agent-inbox`, so every caller moves at once |

A hook that sends on every turn or every tool call (Claude Code's `Stop`, a `PostToolUse` hook without a
`matcher`) floods the inbox. Hook one event, or leave it to the agent's judgment.

### Orca automations

An automation runs on its schedule in two parts:

- **The precheck** runs first, as a plain command with no agent. Exit 0 starts the agent; any other exit, an
  error or a timeout skips the run (run history shows `skipped_precheck`). "Run now" skips the precheck.
- **The prompt** then runs an agent in an Orca workspace: the existing one, or a new worktree per run
  (`workspaceMode`).

So:

- A precheck can only `notify`: no agent waits behind it. Propose a `notify` where the precheck does work by
  itself (a cleanup, a refresh) and it did something or failed, or where it finds a condition the person must
  fix. A precheck that only decides whether there is work to do sends nothing. The call must not change the
  exit code, because the exit code decides whether the agent starts.
- The agent in the prompt is an agent session: when it gets the brief, it judges like any other. It can
  `ask`, and Go to agent then lands on that run's session.
- Look for prompt lines like "only report X" or "do not fix, report": that report goes only to the run's
  terminal, which the person may never open. Say so in the proposal, and that the agent judges whether to
  send it. If the person wants it sent every time, send it from a script the run already runs (snippet B);
  add lines to the prompt (snippet C) only when there is no such script, or the person asks for them.
- Disabled automations are part of the workflow, but propose only how to wire them. Do not propose to enable
  them or change their schedules.

### Snippets

Adapt these in the proposal: fill in the key, the message and the conditions.

**A. Claude Code hook**: in `~/.claude/settings.json`. Add the entry to the `SessionStart` hooks that are
already there and keep every other hook: Orca adds its own hooks to this file. With no `matcher`, it runs when
a session starts, resumes, and after `/clear` and compaction.

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "~/.config/agent-inbox/bin/agent-inbox hook" }] }
    ]
  }
}
```

On Windows, Claude Code runs hook commands in Git Bash, or in PowerShell when Git Bash is missing; this command
runs as written in both.

**B. Script or precheck**: one call, its result ignored. For PowerShell, a `.bat` or `.cmd` script or another
language, and for arguments with `&`, `|`, `<`, `>`, `^` or a line break, call it as `cli.md` says under "In a
script".

```sh
~/.config/agent-inbox/bin/agent-inbox notify nightly-build "build failed: 3 tests red" "$BUILD_URL" || true
```

For a lasting condition, keep a marker file while it holds, and send again only after it cleared and came
back.

**C. Instruction file or automation prompt**: only where sections 2 and 4 send you here. For an agent without
a session-start hook, put the brief under a heading such as `## Agent Inbox` in its global instruction file,
as `agent-inbox hook` prints it in an Orca terminal. For a case the person wants sent every time, add one line
that names the case:

```text
When <the case>, run `~/.config/agent-inbox/bin/agent-inbox notify <KEY> "<what happened; what to do>" "<link>"` once.
```

**D. Record the point**: one per row, run once the row is wired, so the person sees it under Wired points.
`<id>` is letters, digits, `.`, `_` or `-`; give the key as a placeholder such as `<ticket>` when it varies.

```sh
~/.config/agent-inbox/bin/agent-inbox point add agent-ask ask "<work>" "an agent stops for your decision, approval or help, as it judges" "~/.claude/settings.json SessionStart hook (A)"
~/.config/agent-inbox/bin/agent-inbox point add agent-notify notify "<work>" "an agent judges that you should know something" "~/.claude/settings.json SessionStart hook (A)"
~/.config/agent-inbox/bin/agent-inbox point add cleanup-failed notify cleanup "the nightly cleanup failed" "automation Cleanup, precheck cleanup.sh (B)"
```

## 5. Write the proposal

Give the person, in this order:

1. **The workflow** in a few lines: the stages, who or what runs each one, and the agents it uses.
2. **The agents**: for each agent, whether it gets the brief today, and the change that gives it the brief
   (snippet A, the agent's own hook, or snippet C), with its two `point add` commands (D). Name the
   instruction-file lines that the brief makes unnecessary.
3. **The trigger table** of scripts and automations, one row per point:

   | # | Point | Command | Key | Message | Wired in | Repeats |
   | --- | --- | --- | --- | --- | --- | --- |
   | 1 | Fix loop used its rounds | `ask` | ticket id | `<n> bugs left after 3 rounds` | `fix.sh` (B), `--worktree` of the ticket | once per ticket |
   | 2 | Nightly cleanup failed | `notify` | `cleanup` | `cleanup failed: <reason>; run <command> to retry` | automation "Cleanup", precheck `cleanup.sh` (B) | once until it works again |

   "Wired in" names the file, script, hook or automation (precheck or prompt) and the snippet.
4. **The change for each row**: the exact text to add and where (the file and the line or section, or the
   automation and which part), then its `point add` command (D). Add the `point add` and `point remove`
   commands that bring the records in line with what already sends.
5. **Not wired**: the points you left out, each with the reason (an agent with the brief judges it, another
   channel already covers it, it would be noise, there is no place to send from).
6. **How to check once it is wired**: in an Orca terminal, `agent-inbox hook` prints the brief, and an agent
   session started after the change has read it (ask the agent what it knows about Agent Inbox). Inside a
   workspace, `agent-inbox test` puts a TEST card under Waiting on you and `agent-inbox resolve TEST` removes
   it; `agent-inbox notify DRILL "drill message"` puts a line under Messages; each recorded point shows under
   Wired points. Then trigger one real point if that is cheap and safe.

Stop after the proposal.

## 6. Add or remove one point

Change only what this one point needs. Before you change anything, show the person the row (as in the
trigger table of section 5) and the exact change, and wait for their OK. Edit the file where the workflow
reads it, by its absolute path: the workspace you run in may hold only a copy of it, or be unrelated.

**Add a point:**

1. Run `agent-inbox point list` and read what already sends (section 1, "Find what is already wired").
2. If the person has not said what should send, ask them in one question. Offer up to three candidates
   that fit their workflow: the brief for an agent that does not get it yet (section 2), or points of their
   scripts and automations (section 3). A recommended point not recorded yet needs no change from you: the
   person presses **Add this point** under **Recommended points** in the panel.
3. Check the point against the rules in section 3 ("Keep a point only if"). If it fails one, or the point
   already sends, say so and stop. If an agent with the brief would send it by its own judgment, say so: it
   needs no wiring, unless the person wants it sent every time (section 4).
4. Choose the place and the snippet (sections 2 and 4). Show the row and the change; wait for the OK.
5. Make the change, then record the point with `agent-inbox point add` (snippet D).
6. Check it: for the hook, run `agent-inbox hook` in an Orca terminal and show its first line; for a `notify`
   point, send a drill (`agent-inbox notify DRILL "drill message"`); else tell the person how to trigger the
   point. Show the new row from `agent-inbox point list`.

**Remove the point `<id>`:**

1. Read the point from `agent-inbox point list`. If its id starts with `builtin.`, the plugin wires it: tell the
   person to press **Remove** on it in the panel, and stop.
2. Find its call. Look first in the place the point names ("wired in"), then in the places from section 1:
   search for `agent-inbox` calls with its key.
3. Show the lines you will take out; wait for the OK. Keep what other points still use: the hook of section 2
   carries an `ask` and a `notify` point, and stays while either of them is recorded.
4. Take the lines out, then run `agent-inbox point remove <id>`.
5. If you find no call, say so. With the person's OK, remove the record only.

## 7. Align the points

The records drift when a workflow changes by hand: a script is deleted, a prompt is rewritten, a call is added
without `point add`. Bring the records in line with the calls. The calls are the truth; change only the
records.

1. Read the records: `agent-inbox point list`.
2. Find the calls: search for `agent-inbox` in the places from section 1 and in the place each record names
   ("wired in"). For each call note the command (`ask` or `notify`), the key and the place. A call through a
   notify wrapper counts at the wrapper. A hook that runs `agent-inbox hook` counts as an `ask` call and a
   `notify` call. A key that is a variable (`"$TICKET"`) matches a record whose key is a placeholder such as
   `<ticket>`.
3. Read the keys sent within the retention window from the log (`agent-inbox where` prints its path). A key
   that still sends shows a live call, also where you did not find one.
4. Put each record and each call in one row of this table:

   | Found | Fix |
   | --- | --- |
   | A record and its call match | Nothing |
   | A record whose id starts with `builtin.` | Nothing: the plugin wires it, without a call in the workflow |
   | A record and its call differ in command, key or place | `point add <the same id> ...` with the values of the call; the same id replaces the record |
   | A call without a record | `point add` (snippet D), with a new id |
   | A record without a call, and its key has not sent within the window | `point remove <id>` |
   | A record without a call, but its key still sends | Nothing; say that the call is in a place you did not search |

5. List the problems you see in the calls themselves, against the rules in sections 3 and 4: a script call
   whose failure fails the job (no `|| true` or its equivalent), a message longer than one line, a second
   channel for the same event, a secret in a message, two calls for one event, a hook that sends on every
   turn. Do not fix them; the person can fix them, or use **Add a point** and **Remove**.
6. Show the table, the commands and the problems, and wait for the person's OK. If every record matches its
   call, say so and stop.
7. Run the commands the person agreed to, then show `agent-inbox point list`.
