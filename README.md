# Agent Inbox

![Agent Inbox: what waits on you, the messages and the wired points, in Orca's right sidebar](images/cover.png)

An [Orca](https://onorca.dev) plugin: one sidebar panel for what your agents and scripts need from you.

- **Waiting on you**: workspaces an agent parked on the board for your decision or approval, with the reason.
  **Go to agent** jumps to the terminal that asked; **Mark handled** moves the workspace back.
- **Messages**: what you should know (a long job failed, a credential expired), kept 7 days by default.
- **Wired points**: the places in your workflow that send here. **Add a point**, **Align** and **Remove** have
  your agent make the change once you agree.
- **Recommended points**: points Agent Inbox wires itself, added with one press, such as the questions your
  agents ask with AskUserQuestion. See [Recommended points](#recommended-points).

Agents and scripts send with one CLI, `agent-inbox`.

## Get started

Requires Orca 1.4.248 or later, on macOS, Linux or Windows 10 and later. On Windows, see
[what it does not support yet](#not-supported-on-windows-yet).

1. **Install.** In Orca, go to Settings → Plugins → **Add plugin** → **From a Git URL…**, paste

   ```text
   https://github.com/felix-lj-ct/orca-agent-inbox
   ```

   and press **Continue**. Orca takes the latest version tag. It shows the plugin as unverified because it does
   not come from a catalog; press **Install**, then enable it and approve its access (see
   [Permissions](#permissions)).
2. **Open the panel** in the right sidebar. The plugin installs the CLI at
   `~/.config/agent-inbox/bin/agent-inbox`, a guide for agents at `~/.config/agent-inbox/agent-guide.md` and the
   CLI reference beside it, `cli.md` (on Windows, also in [WSL](#wsl)). **Waiting on you** shows a **Set up
   Agent Inbox** task.
3. **Try it** in a terminal of any Orca workspace (on Windows, PowerShell, Git Bash or WSL):

   ```sh
   ~/.config/agent-inbox/bin/agent-inbox test           # the workspace shows under Waiting on you
   ~/.config/agent-inbox/bin/agent-inbox resolve TEST   # it goes away
   ```

4. **Wire your workflow.** Under **Recommended points**, press **Add this point** on the ones you want: they work
   at once. The setup task sends you to **Wired points**: press **Add a point** there for the rest. Your default
   agent starts in the workspace selected in Orca, asks you what should send here, wires it in and records it.
   Then press **Mark handled** on the setup task.

   To go through your whole workflow at once, give your agent this prompt instead (the Log file setting has it
   too):

   > Read ~/.config/agent-inbox/agent-guide.md, go through my workflow, and tell me where to send Agent Inbox messages and how to wire each one.

   The agent reads your agents' settings, instruction files, scripts and Orca automations, and proposes, with
   the exact change for each:

   - a hook that tells your agents about the inbox when a session starts, so that they judge for themselves
     what is worth sending (see [Tell your agents](#tell-your-agents));
   - where your scripts and automations should send (failed jobs, expired credentials, retries used up).

   It changes nothing until you agree.

Later, press **Add a point** again to wire one more point, or give the prompt with a workflow's name in place of
"my workflow".

Optional: to have Claude Code load the guide as a skill:

```sh
mkdir -p ~/.claude/skills/agent-inbox
ln -sf ~/.config/agent-inbox/agent-guide.md ~/.claude/skills/agent-inbox/SKILL.md
```

On Windows, in PowerShell (a symbolic link needs Developer Mode or an administrator):

```powershell
New-Item -ItemType Directory -Force "$HOME\.claude\skills\agent-inbox" | Out-Null
New-Item -ItemType SymbolicLink -Force -Path "$HOME\.claude\skills\agent-inbox\SKILL.md" -Target "$HOME\.config\agent-inbox\agent-guide.md"
```

## Tell your agents

An agent that knows the inbox is there judges for itself what you need to decide or know, so you write no rules
for it. `agent-inbox hook` prints a few lines that tell it: the panel, the commands, and that it decides what is
worth sending. Run it from the agent's session-start hook; it prints nothing outside an Orca terminal. For
Claude Code, add it to the `SessionStart` hooks in `~/.claude/settings.json`, beside the hooks already there:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "~/.config/agent-inbox/bin/agent-inbox hook" }] }
    ]
  }
}
```

An agent without such a hook gets the same lines in its global instruction file.

## Recommended points

**Recommended points**, after **Wired points**, lists points that Agent Inbox wires itself. **Add this point**
records one under **Wired points**, and it works from then on; **Remove** there stops it. No agent runs, and no
file of your workflow changes.

- **Agent questions wait on you** (`builtin.ask-question`): when an agent asks you with the AskUserQuestion tool
  (Claude Code has it), its workspace goes under **Waiting on you** with the first question, and goes once you
  answer or dismiss it. The key is the ticket id in the branch or the folder name, else the folder name. Orca
  does not hook agents on SSH hosts or in WSL yet. If you wired AskUserQuestion yourself with a hook, remove that
  hook once you add this point, or each question is sent twice.

[`RECOMMENDED.md`](RECOMMENDED.md) collects the points people wire, and each release picks some of them for the
panel. To suggest yours, open a pull request that adds it there. The panel shows what came with your version and
does not read the page. To hide the section, turn off **Show recommended points** in the settings.

## The CLI

```sh
agent-inbox notify <key> "<message>" [<url>]   # a line under Messages
agent-inbox ask <key> "<message>" [<url>]      # this workspace waits on you
agent-inbox resolve <key>                      # it no longer does
agent-inbox hook                               # what an agent needs to know to send here
```

`<key>` names the work: a ticket id, a job name. Run `agent-inbox` with no arguments for every command. Add
`~/.config/agent-inbox/bin` to your `PATH` to call it by name. In a script, end the call with `|| true` so a
failed message does not fail the job.

[`guide/cli.md`](guide/cli.md), installed as `~/.config/agent-inbox/cli.md`, is the reference for agents: each
command with its arguments, what you see, which links open, the exit codes, and how to call it from PowerShell,
cmd and WSL.

The CLI runs on Orca's own runtime, so it needs no Node.js of yours. If Orca has moved since it last started,
or runs as an AppImage and is closed, the CLI uses `node` from your `PATH`.

On Windows, `bin` holds `agent-inbox.cmd` for PowerShell and cmd beside `agent-inbox` for Git Bash, so the
commands above run as written in PowerShell and Git Bash. In cmd and in `.bat` or `.cmd` scripts, call
`"%USERPROFILE%\.config\agent-inbox\bin\agent-inbox.cmd"`, with `call` in front in a script, or the script ends
there.

### WSL

In a WSL terminal, `~/.config/agent-inbox` is a link to the Windows folder, so the commands above and the agent
guide work there as written. The plugin makes the link in each WSL distro that has a workspace in Orca, while the
distro runs and the panel is open; a folder of that name that is not a link stays as it is. The CLI runs on
Windows through WSL's interop, on Orca's runtime, so it needs Orca where it was when it last started: it does not
use the `node` of the distro.

If `~/.config/agent-inbox` is missing in a distro, make the link yourself there:

```sh
mkdir -p ~/.config && ln -sfn "$(wslpath -u "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")/.config/agent-inbox" ~/.config/agent-inbox
```

### Not supported on Windows yet

- **`&`, `|`, `<`, `>`, `^` and line breaks from PowerShell and cmd.** They pass the arguments through cmd, which
  splits an argument without spaces at `&`, `|`, `<`, `>` or `^` and cuts one at a line break. In PowerShell,
  quote such an argument twice, as in `'"https://ci.example.com/run?id=1&tab=log"'`. Git Bash passes them as
  written.
- **An AppData folder that is not in your home folder** (folder redirection, a roaming profile on a server).
  Orca gives plugins no `APPDATA`, so the plugin takes `%USERPROFILE%\AppData\Roaming`, and the `orca` and `gh`
  commands it runs do not find Orca or your `gh` sign-in. **Waiting on you**, **Go to agent**, **Mark handled**,
  **Add a point**, **Align**, **Remove** and **Star on GitHub** fail; **Messages** and the CLI in your terminals
  work.

## Settings

Settings → Plugins → Agent Inbox: the log file, how many days to keep messages (7), the board columns that `ask`
moves a workspace to and `resolve` moves it back to (`in-review`, `in-progress`), and the language.

Two switches, both off by default, leave it to you to say when something is done:

- **Keep asks until marked handled**: an ask stays under **Waiting on you** until you press **Mark handled**, also
  after you go to the agent, the agent runs `agent-inbox resolve` or its card leaves the waiting column. One the
  agent resolved says **Agent resumed**. Asks resolved before you turn it on do not come back.
- **Keep messages unread until marked read**: opening a message's link leaves it unread until you press
  **Mark read** or **Mark all read**.

**Show recommended points**, on by default, shows [Recommended points](#recommended-points) after **Wired
points**. Off, the section goes; a recommended point you added keeps working and stays under **Wired points**.

## Permissions

The plugin runs as a `trusted-worker`, a Node.js process with your user's access. It runs the `orca` CLI to read
and move the board and to start your agent, reads which agent is your default from Orca's profile state, and
writes `~/.config/agent-inbox/` and the log. Orca runs its hook before and after each tool call of the agents in
its terminals: the plugin lets every call go on at once, and acts only on AskUserQuestion, while that
[recommended point](#recommended-points) is recorded. On Windows it also runs `wsl.exe` to
list the running WSL distros and link `~/.config/agent-inbox` in those with a workspace in Orca. Its only network request is **Star on GitHub**, made through your
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
