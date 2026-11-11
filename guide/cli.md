# Agent Inbox CLI

`agent-inbox` is how agents and scripts send to the Agent Inbox panel in Orca. The plugin installs it as
`~/.config/agent-inbox/bin/agent-inbox`, with this file beside it as `~/.config/agent-inbox/cli.md`, and rewrites
them whenever Orca starts the plugin or its settings change: edit nothing in `~/.config/agent-inbox`. Run
`agent-inbox` with no arguments for its usage.

## Run it

| Where | Run |
| --- | --- |
| macOS, Linux, Git Bash, PowerShell | `~/.config/agent-inbox/bin/agent-inbox ...` |
| WSL | The same. `~/.config/agent-inbox` is a link to the Windows folder, which the plugin makes in each distro that has a workspace in Orca, while the distro runs and the Agent Inbox panel is open. If it is missing, the person opens the panel, or makes the link as the plugin's README says |
| cmd | `"%USERPROFILE%\.config\agent-inbox\bin\agent-inbox.cmd" ...` |
| A `.bat` or `.cmd` script | `call "%USERPROFILE%\.config\agent-inbox\bin\agent-inbox.cmd" ...`: without `call` the script stops after it |

The CLI runs on Orca's own runtime, so it needs no Node.js of the person's. `agent-inbox where` prints the log,
the points file, the waiting and resolved columns, the orca CLI it found and its settings file: it shows that the
plugin is installed.

## Commands

| Command | The person sees | Runs from | Needs Orca running |
| --- | --- | --- | --- |
| `notify <key> "<message>" [<url>]` | An unread message under Messages, rendered as Markdown, with **Open link** when you give a URL | Anywhere | No |
| `ask [--worktree <path>] <key> "<message>" [<url>]` | A card under Waiting on you with the message rendered as Markdown, and **Open link** when you give a URL; the workspace moves to the waiting column with `<key>: <the first line of the message>` as its comment and an unread dot | Inside an Orca workspace, or anywhere with `--worktree` | Yes |
| `resolve [--worktree <path>] <key>` | The card goes (or, if the person keeps asks until they mark them handled, says the agent resumed); the workspace moves back to the resolved column, if it is still in the waiting column | The workspace of the `ask` | Yes |
| `test [--worktree <path>]` | A TEST card under Waiting on you; `resolve TEST` removes it | An Orca workspace | Yes |
| `hook` | Nothing: it prints the brief, a few lines that tell an agent about the inbox and its commands and leave to it what to send; while the point `builtin.ask-question` is recorded, the brief also says that a question asked with AskUserQuestion reaches the panel by itself | An agent's session-start hook; it prints nothing outside an Orca terminal | No |
| `point add <id> <ask\|notify> <key> "<when>" "<wired in>"` | A row under Wired points; the same id again replaces it | Anywhere | No |
| `point remove <id>` | The row goes | Anywhere | No |
| `point list` | Nothing: it prints the recorded points, one JSON object per line | Anywhere | No |
| `where` | Nothing: it prints the settings in use | Anywhere | No |

## Arguments

- **`<key>`** names the work: a ticket id, a branch, a job or automation name. The panel shows it in bold
  before the message, up to 200 characters.
- **`<message>`** is GitHub-flavoured Markdown, which the panel renders.
  - The first line says it all in about 120 characters: what you need, or what happened and what the person
    should do. The board comment of an `ask` and the CLI's output show only that line, without the `#` of a
    heading.
  - A few lines of detail may follow when they help the person decide or act: the options as a list, the
    failed steps, a small table, `code`, **bold**, links. Logs and long reports belong behind `<url>`.
  - `-` as the message reads it from stdin, up to its end, without the line breaks at the end. Use it for a
    message of more than one line, and for text the shell would change:

    ```sh
    agent-inbox ask PAY-2318 - "https://github.com/acme/payments-api/pull/924" <<'EOF'
    Pick the index migration for **staging**:
    1. Drop `settlement_batch_idx` now (~6 min lock)
    2. Rebuild it `CONCURRENTLY` (~40 min, no lock)
    EOF
    ```

    In PowerShell: `$text | agent-inbox notify <key> -`. A message that is empty on stdin is a usage error.
  - Images show only from the plugin's own files: a link to an image on the web does not show.
  - The panel shows up to 4,000 characters; the log keeps it whole. A message of more than 6 lines or 300
    characters shows its start with **Show more**, so put what matters first.
    Control characters other than tab and line breaks are dropped.
- **`<url>`** is optional, for `notify` and `ask`: the page the person opens to act on the message, such as a
  pull request, a CI run or a ticket. The panel shows **Open link** on the message or the card.
  - Orca opens only `http`, `https` and `mailto` links. **Open link** shows for another link, but it does not
    open.
  - A link longer than 8,192 characters is left out, since a cut one would not open.
  - Opening the link of a message marks it read, unless the person keeps messages unread until marked read (a
    setting of the plugin).
  - An empty `<url>` (`""`) is the same as none.
- **`--worktree <path>`** names the Orca workspace of `ask`, `resolve` and `test`. Put it right after the
  command. Without it, the CLI takes the Git top level of the current directory; outside a Git repository,
  `ask`, `resolve` and `test` then fail with exit code 2.

## Asks and workspaces

- A workspace has one waiting state. A later `ask` in the same workspace replaces the message and the link; one
  `resolve` clears it, whatever key it names.
- `resolve` leaves alone a workspace that the person already moved out of the waiting column.
- The waiting and resolved columns are settings of the plugin; by default `in-review` and `in-progress`.
- An `ask` needs an Orca workspace that waits for the person, and **Go to agent** takes them to the terminal
  that asked. Where there is none (a cron job, CI), send a `notify` that says what to do.

## Points

A point is a place in the workflow that sends. `point add` records it for the panel's Wired points; it sends
nothing itself.

- `<id>` is letters, digits, `.`, `_` or `-`. Ids that start with `builtin.` are the recommended points, which
  the plugin wires itself: the person adds and removes them in the panel.
- `<key>` is the key that the point sends: a placeholder such as `<ticket>` when it varies.
- `<when>` says when it sends; `<wired in>` names the file, script, hook or automation that sends it.
- `point list` prints one JSON object per line, with `id`, `kind`, `key`, `when`, `wiredIn` and `ts`.

## In a script

A failed message must not fail the job. Ignore the exit code of the CLI:

| The script runs in | Call |
| --- | --- |
| sh, bash, Git Bash, WSL | `~/.config/agent-inbox/bin/agent-inbox notify <key> "<message>" "$URL" \|\| true` |
| PowerShell | `try { ~/.config/agent-inbox/bin/agent-inbox notify <key> "<message>" } catch {}`: `\|\| true` does not work there |
| A `.bat` or `.cmd` script | `call "%USERPROFILE%\.config\agent-inbox\bin\agent-inbox.cmd" notify <key> "<message>" \|\| ver >nul` |
| Another language | Run the same command and ignore its exit code |

PowerShell and cmd pass the arguments through cmd, which splits an argument without spaces at `&`, `|`, `<`, `>`
or `^`, and cuts one at a line break. In PowerShell, quote such an argument twice, as in
`'"https://ci.example.com/run?id=1&tab=log"'`. Git Bash and WSL pass them as written.

## Output and exit codes

When a command works, the CLI prints one line, such as `notify <key>: <the first line of the message>`. When it fails, it prints
`agent-inbox: <the reason>` to stderr, or its usage for wrong arguments.

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Another error |
| 2 | Wrong usage: a missing argument, a bad point id or kind, no workspace for `ask`, `resolve` or `test` |
| 3 | The orca CLI is missing or failed: Orca is not running, or its "orca command" setting is wrong |
| 4 | The log stayed locked: remove `<log>.lock` if no `agent-inbox` and no Orca runs |

## The log

Each `notify`, `ask` and `resolve` is a line in a plain text file (`agent-inbox where` prints its path): send no
secrets, in the message or in the link. The plugin removes the lines older than the retention window (by default
7 days); an ask that still waits on the person stays.
