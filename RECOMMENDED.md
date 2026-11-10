# Recommended points

A point is a place in your workflow that sends to Agent Inbox. This file collects the points people wire, and
each release of Agent Inbox picks some of them for the panel. **Recommended points**, after **Wired points**,
lists the ones you have not added yet. The panel shows what came with your version of the plugin: it does not
read this page. To hide the section, turn off **Show recommended points** in the plugin's settings.

## In Agent Inbox

The plugin wires these itself. **Add this point** records the point under **Wired points**, and it works from
then on; **Remove** there stops it. No agent runs, and no file of your workflow changes.

### Agent questions wait on you: `builtin.ask-question`

| | |
| --- | --- |
| Shows under | Waiting on you |
| Key | A ticket id in the branch or the folder name, such as `PROJ-12`, else the folder name |
| Sends when | An agent in an Orca terminal asks you with the AskUserQuestion tool; it goes once you answer or dismiss the question |

Orca runs the plugin's hook on each tool call of the agents in its terminals. On AskUserQuestion, the plugin runs
`agent-inbox ask` in the agent's workspace and terminal, with the first question as the reason (and `(1/3)` after
it when the agent asks three), and `agent-inbox resolve` once the question is answered or dismissed. The brief
that `agent-inbox hook` gives your agents then says that such questions reach the panel by themselves.

- Claude Code has the AskUserQuestion tool; other agents send nothing through this point.
- Orca does not hook agents on SSH hosts or in WSL yet.
- If you wired AskUserQuestion yourself, with a `PreToolUse` hook that runs `agent-inbox ask` or a script that
  does, remove that hook and its record once you add this point, or each question is sent twice.

## Collected

Points that people wire in their own workflows, for each release to pick from.

### Agents know the inbox

| | |
| --- | --- |
| Shows under | Waiting on you (`ask`) and Messages (`notify`) |
| Key | What the agent names: a ticket id, a branch |
| Sends when | The agent judges that you must decide, approve or help, or should know something you would not see otherwise |
| Wired in | Claude Code's `SessionStart` hook in `~/.claude/settings.json`; another agent's session-start hook |

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "~/.config/agent-inbox/bin/agent-inbox hook" }] }
    ]
  }
}
```

The README says more in [Tell your agents](README.md#tell-your-agents).

## Suggest a point

Open a pull request that adds your point under **Collected**, in this form:

````md
### <What it does, in a few words>

| | |
| --- | --- |
| Shows under | Waiting on you (`ask`) or Messages (`notify`) |
| Key | The key it sends |
| Sends when | When it sends, and when it no longer waits, for an ask |
| Wired in | The hook, script or automation that sends, and the agent or tool it needs |

<The change that wires it: the hook setting, or the lines of the script.>
````

A good point sends what the person would otherwise miss or wait for, sends it once, and never fails the job it
is in: a script ends the call with `|| true`. The message and its link go into a plain text log, so they hold no
secrets.
