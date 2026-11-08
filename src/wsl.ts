// WSL terminals have a home folder of their own, where agents look for ~/.config/agent-inbox too. On Windows the
// worker links it to the Windows one in each WSL distro that has an Orca workspace, so the CLI (which runs on
// Windows from there; see shLauncher), its settings and the agent guide are the same in WSL. It leaves a folder of
// the person's alone, and links a distro only while it runs: Orca does not start a stopped distro, nor does this.
import { join } from 'node:path'

/** wsl.exe, in every Windows since 10. */
export const WSL_EXE = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')

/** The distros of the workspaces Orca has in WSL: their paths are \\wsl.localhost\<distro>\... or \\wsl$\<distro>\... */
export function wslDistros(worktrees: { path?: unknown }[]): string[] {
  const distros = new Map<string, string>()
  for (const w of worktrees) {
    const match = typeof w.path === 'string' ? /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)/i.exec(w.path) : null
    // distro names are the same in any case
    if (match && !distros.has(match[1].toLowerCase())) distros.set(match[1].toLowerCase(), match[1])
  }
  return [...distros.values()]
}

/**
 * The names `wsl.exe --list --quiet` prints, one a line. An older wsl.exe prints UTF-16 whatever WSL_UTF8 says,
 * which read as UTF-8 leaves a NUL after each letter.
 */
export function distroNames(output: string): string[] {
  return output
    .replace(/[\0\uFEFF\uFFFD]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Points $HOME/.config/agent-inbox at $1, a Windows folder, and says what it changed. One line, since it passes
 * through a Windows command line.
 */
export const LINK_SCRIPT = [
  'dir=$(wslpath -u "$1") || exit 1',
  'link="$HOME/.config/agent-inbox"',
  '[ "$(readlink "$link")" = "$dir" ] && exit 0',
  'if [ -e "$link" ] && [ ! -L "$link" ]; then echo "$link is a folder of its own: left as it is"; exit 0; fi',
  'mkdir -p "$HOME/.config" && ln -sfn "$dir" "$link" && echo "linked $link to $dir"'
].join('; ')

/** wsl.exe's arguments that link ~/.config/agent-inbox in distro to dir, as its default user. */
export const linkArgs = (distro: string, dir: string) => ['-d', distro, '--exec', 'sh', '-c', LINK_SCRIPT, 'sh', dir]
