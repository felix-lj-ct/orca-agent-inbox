// A fake orca CLI for the tests, the same on every platform: node itself, with a script that NODE_OPTIONS
// preloads into the node processes a test starts. The script acts only in a node started as
// `node <orca command> ...`, the way the CLI and the worker call orca once orca is this node; a node started
// as `node agent-inbox.mjs ...` runs as usual. It records each call, and the ORCA_CLI_CWD it got, and answers
// with what the test set, and like orca on Windows it fails without APPDATA.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const preload = (dir: string) => `const { appendFileSync, existsSync, readFileSync, writeSync } = require('node:fs')
const { basename, join } = require('node:path')
const dir = ${JSON.stringify(dir)}
const first = process.argv[1]
if (first && ['worktree', 'terminal', 'agent'].includes(basename(first)) && !existsSync(first)) {
  // as orca does on Windows: it finds the running Orca through APPDATA
  if (process.platform === 'win32' && !process.env.APPDATA && !process.env.ORCA_USER_DATA_PATH) {
    writeSync(2, 'APPDATA is not set, so the Orca runtime metadata path cannot be resolved.\\n')
    process.exit(1)
  }
  const args = [basename(first), ...process.argv.slice(2)]
  appendFileSync(join(dir, 'calls'), args.join(' ') + '\\n')
  if (process.env.ORCA_CLI_CWD) appendFileSync(join(dir, 'cli-cwd'), process.env.ORCA_CLI_CWD + '\\n')
  const answer = join(dir, args.slice(0, 2).join(' ') + '.json')
  writeSync(1, existsSync(answer) ? readFileSync(answer, 'utf8') : '{"ok":true,"result":{}}\\n')
  process.exit(0)
}
`

export interface FakeOrca {
  /** The orca command to set: this node. */
  command: string
  /** NODE_OPTIONS for the processes the test starts, so the fake is there when they call orca. */
  nodeOptions: string
  /**
   * What `orca <command>` (two words, such as `worktree ps`) answers from now on, as orca prints it, on several
   * lines; others answer an empty result.
   */
  answer(command: string, result: unknown): void
  /** The calls so far, each as its arguments joined by spaces. */
  calls(): string[]
  /** The ORCA_CLI_CWD of each call that had one. */
  cliCwds(): string[]
}

const lines = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [])

export function fakeOrca(home: string): FakeOrca {
  const dir = join(home, 'fake-orca')
  mkdirSync(dir, { recursive: true })
  const script = join(dir, 'preload.cjs')
  writeFileSync(script, preload(dir))
  return {
    command: process.execPath,
    // forward slashes: NODE_OPTIONS reads a backslash inside quotes as an escape
    nodeOptions: `--require "${script.replaceAll('\\', '/')}"`,
    answer: (command, result) => writeFileSync(join(dir, `${command}.json`), `${JSON.stringify({ ok: true, result }, null, 2)}\n`),
    calls: () => lines(join(dir, 'calls')),
    cliCwds: () => lines(join(dir, 'cli-cwd'))
  }
}
