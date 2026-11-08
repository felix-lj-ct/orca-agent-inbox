---
name: agent-inbox
description: Use when the person asks where their workflow should ask them or tell them something through Agent Inbox, asks to set up, review or extend Agent Inbox for their workflow, asks to add or remove one Agent Inbox point, or asks to align the recorded points with the workflow. Explains how to learn the workflow (instruction files, scripts, Orca automations), find the points that should send, and propose how to wire each one. For a whole workflow it produces a proposal and changes no files; for one point it makes the change once the person agrees; to align, it changes only the records, once the person agrees.
---

# Agent Inbox: find where a workflow should send

Agent Inbox is an Orca plugin. Its sidebar panel shows the person three lists:

- **Waiting on you**: workspaces that an agent moved to the board's waiting column with `agent-inbox ask`,
  each with the reason and a button that goes to the terminal of the agent that asked.
- **Messages**: lines sent with `agent-inbox notify`, kept for the retention window (default 7 days).
- **Wired points**: the points of the workflow that send, recorded with `agent-inbox point add`, so the
  person can see what may write to the inbox and where it is wired.

What the person asked decides your job:

- **Go through a workflow** (all of it, or one workflow by name): learn it, find the points where it should
  ask them or tell them something, and give them a proposal that says which points to wire and how
  (sections 1 to 4). **Change no files.** The person reads the proposal, cuts rows, and applies it later or
  asks for it in a separate request.
- **Add one point, or remove the point `<id>`**: the panel's **Add a point** and **Remove** buttons start you
  with this request. Make that one change in the workflow and in the records, once the person agrees to it
  (section 5).
- **Align the points**: the panel's **Align** button starts you with this request. Compare the records with
  the calls in the workflow and fix the records, once the person agrees (section 6). **Change no workflow
  files.**

Check the plugin first:

```sh
~/.config/agent-inbox/bin/agent-inbox where
```

If this fails, the plugin is not installed or has not started yet. Tell the person and stop. On Windows this
command runs as written in PowerShell and Git Bash; in cmd, run
`"%USERPROFILE%\.config\agent-inbox\bin\agent-inbox.cmd" where`.

## What the CLI does

| Command | The person sees | Runs from |
| --- | --- | --- |
| `agent-inbox ask <key> "<message>" [<url>]` | A card under Waiting on you; the workspace moves to the waiting column with an unread dot | Inside an Orca workspace, or with `--worktree <path>` right after `ask` |
| `agent-inbox resolve <key>` | The card goes; the workspace moves back to the resolved column, if it is still waiting | The same workspace |
| `agent-inbox notify <key> "<message>" [<url>]` | A line under Messages | Anywhere |
| `agent-inbox point add <id> <ask\|notify> <key> "<when>" "<wired in>"` | A row under Wired points; the same id again replaces it | Anywhere |
| `agent-inbox point remove <id>` / `agent-inbox point list` | The row goes / the recorded points, one JSON object per line | Anywhere |

The key names the work (ticket id, job name, automation name). A workspace has one waiting state: a later
`ask` replaces the reason, one `resolve` clears it. Run `agent-inbox` with no arguments for its usage.

## 1. Learn the workflow

Read what exists before you ask:

- **Agent instruction files**: `CLAUDE.md`, `AGENTS.md`, rules folders, and the skills the workflow uses.
- **Scripts**: the scripts the workflow runs, Makefiles, READMEs.
- **Orca automations**: `orca automations list --json`. For each one note its name, schedule (`rrule`),
  whether it is enabled, `precheck.command`, `prompt`, and workspace (`workspaceMode`, `runContext.path`).
  Read the precheck script, and find what the prompt tells the agent to report. `orca automations runs --id
  <id>` shows how often it runs, skips and fails.
- **Other schedules and CI**: `crontab -l`, launchd agents, on Windows the Task Scheduler
  (`Get-ScheduledTask` in PowerShell, or `schtasks /query /fo list /v`), CI pipelines and their schedules.
- **What already notifies**: notify wrappers, desktop notifications (`osascript`, `terminal-notifier`,
  `notify-send`, PowerShell toasts such as BurntToast), mail, chat webhooks, Jira or PR comments the person reads.

If the person names one workflow, read and propose for that one only.

Find what is already wired: run `agent-inbox point list` for the recorded points, search those same places
for `agent-inbox`, and read the keys in the log (`agent-inbox where` prints its path). Do not propose a point
again that already sends, or snippet A where it is already in place. Use the same key names and the same
notify wrapper as the points already wired. Compare the records with what you found: a recorded point whose
call is gone needs a `point remove`, and a call without a record needs a `point add` (snippet D).

Then ask the person only for the gaps: the stages from start to done, who or what runs each one (the person,
an agent, a script, an Orca automation), and where they wait or get surprised today.

## 2. Find the trigger points

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

To choose between them: if the work stops until the person acts, it is an `ask`. An `ask` needs an Orca
workspace and an agent that waits for the answer, so a script sends a `notify` that says what to do.

Keep a point only if all of these are true:

- **The person acts on it or wants to know it.** Progress updates, a turn that ended normally (Orca already
  shows agent states) and routine successes are not points.
- **One channel.** If the person already gets it through a channel they read, propose to point that channel
  at `agent-inbox` or leave the point out. Never add a second message for the same event.
- **One line.** It fits in about 120 characters: what is needed, or what happened and what the person should
  do. Add the URL when there is a page to open. No secrets: the log is a plain text file.
- **Once.** A lasting condition (an expired credential, a missing input) is sent once, not on every run.

Fewer points are better: every message should be one the person acts on or wants to know.

## 3. Choose how each point is wired

Wire each point in the one place that owns it, and only in places that exist today. If a point has no place
to send from (the person checks it by hand), list it under "Not wired" with the reason.

| The point is in | Wire it like this |
| --- | --- |
| An interactive agent session | The "Stopping for me" section in the instruction file the workflow already uses (snippet A) |
| A script | One CLI call at the point; a failed message must not fail the job (snippet B) |
| An Orca automation's precheck | A `notify` call in the precheck script (snippet B); see below |
| An Orca automation's prompt | Lines in the prompt that say when to `ask` and when to `notify` (snippet C); see below |
| A notify wrapper or channel the workflow already has | Point the wrapper at `agent-inbox`, so every caller moves at once |

Prefer an explicit call at the point over a hook that fires on every agent event; those flood the inbox.

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
- The agent in the prompt can `ask`: Go to agent then lands on that run's session. Propose an `ask` where the
  prompt makes the agent stop for the person, and a `notify` where the result needs the person (a failure, a
  report link, a filed bug). A run that passed or found nothing sends nothing; the run history has it.
- Look for prompt lines like "only report X" or "do not fix, report": that report goes only to the run's
  terminal, which the person may never open. These are often the best points.
- Disabled automations are part of the workflow, but propose only how to wire them. Do not propose to enable
  them or change their schedules.

### Snippets

Adapt these in the proposal: fill in the key, the message and the conditions.

**A. Instruction file** (agent behavior lives here, not in this guide):

```markdown
## Stopping for me
When you cannot go on without my decision, approval or help:
1. Run `~/.config/agent-inbox/bin/agent-inbox ask <KEY> "<what you need, one line>"` in the workspace.
2. Start your reply with `[needs you] <KEY>`, ask the question, and stop.
3. When I answer and you go on, run `~/.config/agent-inbox/bin/agent-inbox resolve <KEY>`.
Finishing normally is not a stop: send nothing. If the command fails, put its error in your reply; do not retry.
```

**B. Script or precheck**: one call, its result ignored. In another language, run the same command and
ignore its exit code.

```sh
~/.config/agent-inbox/bin/agent-inbox notify nightly-build "build failed: 3 tests red" "$BUILD_URL" || true
```

For a lasting condition, keep a marker file while it holds, and send again only after it cleared and came
back.

On Windows, the command above runs as written in Git Bash. In PowerShell, `|| true` does not work: call
`~/.config/agent-inbox/bin/agent-inbox` inside `try { ... } catch {}`. In a `.bat` or `.cmd` script, use
`call "%USERPROFILE%\.config\agent-inbox\bin\agent-inbox.cmd" ... || ver >nul`: without `call` the script stops
after it. PowerShell and cmd pass the arguments through cmd, which splits an argument without spaces at `&`, `|`,
`<`, `>` or `^`, and cuts one at a line break: in PowerShell, quote such an argument twice, as in
`'"https://ci.example.com/run?id=1&tab=log"'`.

**C. Automation prompt**:

```text
If you must stop for my decision or help, run `~/.config/agent-inbox/bin/agent-inbox ask <NAME> "<one line>"`
before you stop. If the result needs me (<conditions>), run
`~/.config/agent-inbox/bin/agent-inbox notify <NAME> "<what happened; what to do>" "<link>"` once at the end.
Send nothing when <the run passed or found nothing>.
```

**D. Record the point**: one per row, run once the row is wired, so the person sees it under Wired points.
`<id>` is letters, digits, `.`, `_` or `-`; give the key as a placeholder such as `<ticket>` when it varies.

```sh
~/.config/agent-inbox/bin/agent-inbox point add cleanup-failed notify cleanup "the nightly cleanup failed" "automation Cleanup, precheck cleanup.sh (B)"
```

## 4. Write the proposal

Give the person, in this order:

1. **The workflow** in a few lines: the stages, and who or what runs each one.
2. **The trigger table**, one row per point:

   | # | Point | Command | Key | Message | Wired in | Repeats |
   | --- | --- | --- | --- | --- | --- | --- |
   | 1 | Design decision during implementation | `ask` | ticket id | `<question in one line>` | `CLAUDE.md` (A) | once per question |
   | 2 | Nightly cleanup failed | `notify` | `cleanup` | `cleanup failed: <reason>; run <command> to retry` | automation "Cleanup", precheck `cleanup.sh` (B) | once until it works again |

   "Wired in" names the file, script or automation (precheck or prompt) and the snippet.
3. **The change for each row**: the exact text to add and where (the file and the line or section, or the
   automation and which part), then its `point add` command (D). For an automation prompt, show the lines
   to add, not the whole prompt. Add the `point add` and `point remove` commands that bring the records in
   line with what already sends.
4. **Not wired**: the points you left out, each with the reason (another channel already covers it, it
   would be noise, there is no place to send from).
5. **How to check once it is wired**: inside a workspace, `agent-inbox test` puts a TEST card under Waiting on
   you and `agent-inbox resolve TEST` removes it; `agent-inbox notify DRILL "drill message"` puts a line under
   Messages; each recorded point shows under Wired points. Then trigger one real point if that is cheap and
   safe.

Stop after the proposal.

## 5. Add or remove one point

Change only what this one point needs. Before you change anything, show the person the row (as in the
trigger table of section 4) and the exact change, and wait for their OK. Edit the file where the workflow
reads it, by its absolute path: the workspace you run in may hold only a copy of it, or be unrelated.

**Add a point:**

1. Run `agent-inbox point list` and read what already sends (section 1, "Find what is already wired").
2. If the person has not said what should send, ask them in one question. Offer up to three candidates
   that fit their workflow, from the kinds in section 2.
3. Check the point against the rules in section 2 ("Keep a point only if"). If it fails one, or the point
   already sends, say so and stop.
4. Choose the place and the snippet (section 3). Show the row and the change; wait for the OK.
5. Make the change, then record the point with `agent-inbox point add` (snippet D).
6. Check it: send a drill for a `notify` point (`agent-inbox notify DRILL "drill message"`), or tell the
   person how to trigger the point. Show the new row from `agent-inbox point list`.

**Remove the point `<id>`:**

1. Read the point from `agent-inbox point list`.
2. Find its call. Look first in the place the point names ("wired in"), then in the places from section 1:
   search for `agent-inbox` calls with its key.
3. Show the lines you will take out; wait for the OK. Keep what other points still use, such as the
   "Stopping for me" section (snippet A) while another `ask` point needs it.
4. Take the lines out, then run `agent-inbox point remove <id>`.
5. If you find no call, say so. With the person's OK, remove the record only.

## 6. Align the points

The records drift when a workflow changes by hand: a script is deleted, a prompt is rewritten, a call is added
without `point add`. Bring the records in line with the calls. The calls are the truth; change only the
records.

1. Read the records: `agent-inbox point list`.
2. Find the calls: search for `agent-inbox` in the places from section 1 and in the place each record names
   ("wired in"). For each call note the command (`ask` or `notify`), the key and the place. A call through a
   notify wrapper counts at the wrapper. A key that is a variable (`"$TICKET"`) matches a record whose key is a
   placeholder such as `<ticket>`.
3. Read the keys sent within the retention window from the log (`agent-inbox where` prints its path). A key
   that still sends shows a live call, also where you did not find one.
4. Put each record and each call in one row of this table:

   | Found | Fix |
   | --- | --- |
   | A record and its call match | Nothing |
   | A record and its call differ in command, key or place | `point add <the same id> ...` with the values of the call; the same id replaces the record |
   | A call without a record | `point add` (snippet D), with a new id |
   | A record without a call, and its key has not sent within the window | `point remove <id>` |
   | A record without a call, but its key still sends | Nothing; say that the call is in a place you did not search |

5. List the problems you see in the calls themselves, against the rules in sections 2 and 3: a script call
   whose failure fails the job (no `|| true` or its equivalent), a message longer than one line, a second
   channel for the same event, a secret in a message, two calls for one event. Do not fix them; the person can
   fix them, or use **Add a point** and **Remove**.
6. Show the table, the commands and the problems, and wait for the person's OK. If every record matches its
   call, say so and stop.
7. Run the commands the person agreed to, then show `agent-inbox point list`.
