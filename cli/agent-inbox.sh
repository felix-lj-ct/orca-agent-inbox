#!/usr/bin/env bash
# agent-inbox: how an agent or a script tells the person at the Orca window something. The Agent Inbox
# plugin shows it in its sidebar panel. The plugin installs this file as ~/.config/agent-inbox/bin/agent-inbox
# and rewrites it, with config.env beside it, whenever Orca starts it or its settings change: edit neither.
#
#   agent-inbox notify <key> <message> [<url>]
#       a line in the panel's Messages: something happened, nothing waits on the person
#   agent-inbox ask [--worktree <path>] <key> <message> [<url>]
#       you stop until the person answers: the workspace moves to the waiting column with
#       "<key>: <message>" as its comment and the unread dot, and the panel lists it under Waiting on you
#   agent-inbox resolve [--worktree <path>] <key>
#       the person answered: the workspace moves back to the resolved column, if it is still waiting
#   agent-inbox test [--worktree <path>]
#       drill: an ask for the key TEST; undo it with `agent-inbox resolve TEST`
#   agent-inbox where
#       print the settings in use
#
# <key> names the work (a ticket, a job, a workspace). --worktree defaults to the Git top level of the
# current directory. Settings: the environment (AGENT_INBOX_LOG, AGENT_INBOX_WAITING, AGENT_INBOX_RESUME,
# AGENT_INBOX_ORCA), then ~/.config/agent-inbox/config.env, then the defaults below.
# Exit codes: 0 done, 2 usage, 3 the orca CLI is missing or failed, 4 the log stayed locked.
set -euo pipefail

CONFIG=$HOME/.config/agent-inbox/config.env
env_log=${AGENT_INBOX_LOG:-} env_waiting=${AGENT_INBOX_WAITING:-} env_resume=${AGENT_INBOX_RESUME:-} env_orca=${AGENT_INBOX_ORCA:-}
# shellcheck source=/dev/null
if [ -f "$CONFIG" ]; then . "$CONFIG"; fi
LOG=${env_log:-${AGENT_INBOX_LOG:-$HOME/.local/state/agent-inbox/inbox.jsonl}}
WAITING=${env_waiting:-${AGENT_INBOX_WAITING:-in-review}}
RESUME=${env_resume:-${AGENT_INBOX_RESUME:-in-progress}}
ORCA=${env_orca:-${AGENT_INBOX_ORCA:-}}
case $LOG in "~/"*) LOG=$HOME/${LOG#"~/"} ;; esac

die() { code=$1; shift; echo "agent-inbox: $*" >&2; exit "$code"; }
usage() { sed -n '/^#   agent-inbox notify/,/^#       print the settings/s/^#//p' "$0" >&2; exit 2; }

find_orca() {
  [ -z "$ORCA" ] || return 0
  if [ -n "${ORCA_CLI_BIN_DIR:-}" ] && [ -x "$ORCA_CLI_BIN_DIR/orca" ]; then ORCA=$ORCA_CLI_BIN_DIR/orca
  elif command -v orca >/dev/null 2>&1; then ORCA=$(command -v orca)
  elif [ -x /Applications/Orca.app/Contents/Resources/bin/orca ]; then ORCA=/Applications/Orca.app/Contents/Resources/bin/orca
  else return 1
  fi
}

orca_cli() {
  local out
  find_orca || die 3 "orca CLI not found: set \"orca command\" in the Agent Inbox settings, or AGENT_INBOX_ORCA"
  out=$("$ORCA" "$@" --json 2>&1) || die 3 "orca $1 $2 failed (is Orca running?): $out"
  printf '%s\n' "$out"
}

# A JSON string: control characters other than tab, newline and return dropped, the rest escaped.
# The replacements are quoted variables so bash 3.2 and bash 5.2 (patsub_replacement) agree.
json() {
  local s b='\' q='"'
  s=$(printf '%s' "$1" | LC_ALL=C tr -d '\000-\010\013\014\016-\037')
  s=${s//"$b"/"$b$b"}
  s=${s//"$q"/"$b$q"}
  s=${s//$'\t'/"${b}t"}
  s=${s//$'\n'/"${b}n"}
  s=${s//$'\r'/"${b}r"}
  printf '"%s"' "$s"
}
json_or_null() { if [ -n "$1" ]; then json "$1"; else printf 'null'; fi; }

# The plugin prunes the log under the same lock, so a line appended meanwhile is never lost.
LOCK=$LOG.lock
unlock() { rmdir "$LOCK" 2>/dev/null || true; }
lock() {
  local tries=0
  until mkdir "$LOCK" 2>/dev/null; do
    tries=$((tries + 1))
    # nothing holds the lock for more than a moment: after ~5 s it was left by a killed process
    if [ "$tries" -eq 50 ]; then rm -rf "$LOCK"; fi
    [ "$tries" -le 60 ] || die 4 "$LOCK stayed locked; remove it if no agent-inbox or Orca is running"
    sleep 0.1
  done
  trap unlock EXIT
}

append() { # kind key message url worktree
  local line
  line=$(printf '{"v":1,"ts":"%s","kind":"%s","key":%s,"message":%s,"url":%s,"worktree":%s,"terminal":%s}' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$(json "$2")" "$(json "$3")" "$(json_or_null "$4")" \
    "$(json_or_null "$5")" "$(json_or_null "${ORCA_TERMINAL_HANDLE:-}")")
  mkdir -p "$(dirname "$LOG")"
  lock
  printf '%s\n' "$line" >> "$LOG"
  unlock
  trap - EXIT
}

[ $# -ge 1 ] || usage
cmd=$1
shift
wt=''
if [ "${1:-}" = --worktree ]; then
  [ $# -ge 2 ] || usage
  wt=$2
  shift 2
fi
workspace() {
  wt=${wt:-$(git rev-parse --show-toplevel 2>/dev/null || true)}
  [ -n "$wt" ] || die 2 "no workspace: run inside it or pass --worktree <path>"
}

case $cmd in
  notify)
    [ $# -ge 2 ] && [ -n "$2" ] || usage
    append notify "$1" "$2" "${3:-}" "${wt:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
    echo "notify $1: $2"
    ;;
  ask | test)
    if [ "$cmd" = test ]; then set -- TEST "Drill from agent-inbox test; undo it with: agent-inbox resolve TEST"; fi
    [ $# -ge 2 ] && [ -n "$2" ] || usage
    workspace
    orca_cli worktree set --worktree "path:$wt" --workspace-status "$WAITING" --comment "$1: $2" --unread >/dev/null
    append ask "$1" "$2" "${3:-}" "$wt"
    echo "ask $1: $2"
    ;;
  resolve)
    [ $# -ge 1 ] || usage
    workspace
    shown=$(orca_cli worktree show --worktree "path:$wt" | tr -d ' \n')
    # leave a workspace the person already moved on alone
    case $shown in *"\"workspaceStatus\":\"$WAITING\""*)
      orca_cli worktree set --worktree "path:$wt" --workspace-status "$RESUME" --comment "" >/dev/null ;;
    esac
    append resolve "$1" "" "" "$wt"
    echo "resolve $1"
    ;;
  where)
    find_orca || true
    printf 'log      %s\nwaiting  %s\nresolved %s\norca     %s\nconfig   %s\n' "$LOG" "$WAITING" "$RESUME" "${ORCA:-not found}" "$CONFIG"
    ;;
  -h | --help | help) usage ;;
  *) usage ;;
esac
