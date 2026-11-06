# Agent Inbox

![Agent Inbox: what waits on you, the messages and the wired points, in Orca's right sidebar](images/cover.png)

An [Orca](https://onorca.dev) plugin: one sidebar panel for what your agents and scripts need from you.

- **Waiting on you**: workspaces an agent parked on the board for your decision or approval, with the reason.
  **Go to agent** jumps to the terminal that asked; **Mark handled** moves the workspace back.
- **Messages**: what you should know (a long job failed, a credential expired), kept 7 days by default.
- **Wired points**: the places in your workflow that send here. **Add a point**, **Align** and **Remove** have
  your agent make the change once you agree.

Agents and scripts send with one CLI, `agent-inbox`.

## Get started

Requires Orca 1.4.248 or later, on macOS or Linux.

1. **Install.** In Orca, go to Settings → Plugins → **Add plugin** → **From a Git URL…**, paste

   ```text
   https://github.com/felix-lj-ct/orca-agent-inbox
   ```

   and press **Continue**. Orca takes the latest version tag. It shows the plugin as unverified because it does
   not come from a catalog; press **Install**, then enable it and approve its access (see
   [Permissions](#permissions)).
2. **Open the panel** in the right sidebar. The plugin installs the CLI at
   `~/.config/agent-inbox/bin/agent-inbox` and a guide for agents at `~/.config/agent-inbox/agent-guide.md`.
   **Waiting on you** shows a **Set up Agent Inbox** task.
3. **Try it** in a terminal of any Orca workspace:

   ```sh
   ~/.config/agent-inbox/bin/agent-inbox test           # the workspace shows under Waiting on you
   ~/.config/agent-inbox/bin/agent-inbox resolve TEST   # it goes away
   ```

4. **Wire your workflow.** Give your agent this prompt (**Copy prompt** on the setup task copies it):

   > Read ~/.config/agent-inbox/agent-guide.md, go through my workflow, and tell me where to send Agent Inbox messages and how to wire each one.

   The agent reads your instruction files, scripts and Orca automations, and proposes where to send (decision
   gates, approvals, failed jobs, expired credentials) with the exact change for each. It changes nothing until
   you agree. Then press **Mark handled** on the setup task.

Later, press **Add a point** in the panel to wire one more point, or give the same prompt with a workflow's name
in place of "my workflow".

Optional: to have Claude Code load the guide as a skill:

```sh
mkdir -p ~/.claude/skills/agent-inbox
ln -sf ~/.config/agent-inbox/agent-guide.md ~/.claude/skills/agent-inbox/SKILL.md
```

## The CLI

```sh
agent-inbox notify <key> "<message>" [<url>]   # a line under Messages
agent-inbox ask <key> "<message>" [<url>]      # this workspace waits on you
agent-inbox resolve <key>                      # it no longer does
```

`<key>` names the work: a ticket id, a job name. Run `agent-inbox` with no arguments for every command. Add
`~/.config/agent-inbox/bin` to your `PATH` to call it by name. In a script, end the call with `|| true` so a
failed message does not fail the job.

## Settings

Settings → Plugins → Agent Inbox: the log file, how many days to keep messages (7), the board columns that `ask`
moves a workspace to and `resolve` moves it back to (`in-review`, `in-progress`), and the language.

## Permissions

The plugin runs as a `trusted-worker`, a Node.js process with your user's access. It runs the `orca` CLI to read
and move the board and to start your agent, reads which agent is your default from Orca's profile state, and
writes `~/.config/agent-inbox/` and the log. Its only network request is **Star on GitHub**, made through your
`gh` CLI when you press it.

## Develop

```sh
orca plugin test .
orca plugin check .
orca plugin validate .
orca plugin dev load . --approve <fingerprint>   # Orca prints the fingerprint
```

## License

MIT
