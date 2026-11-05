import { assert, test } from 'orca/testing'
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeProfileDir, activeWorkspace, defaultAgent, orcaDataDir } from './launch'

const sqlite = (db: string, sql: string) =>
  new Promise<string>((resolve, reject) => execFile('sqlite3', ['-readonly', db, sql], (e, out) => (e ? reject(e) : resolve(String(out)))))
const hasSqlite = (() => {
  try {
    execFileSync('sqlite3', ['-version'])
    return true
  } catch {
    return false
  }
})()

test("Orca's data folder and the active profile in it", () => {
  assert.equal(orcaDataDir('/h', 'darwin'), '/h/Library/Application Support/orca')
  assert.equal(orcaDataDir('/h', 'linux'), '/h/.config/orca')
  assert.equal(orcaDataDir('/h', 'linux', { XDG_CONFIG_HOME: '/x' }), '/x/orca')
  const data = mkdtempSync(join(tmpdir(), 'agent-inbox-orca-'))
  assert.equal(activeProfileDir(data), join(data, 'profiles', 'local-default'))
  writeFileSync(join(data, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: 'work' }))
  assert.equal(activeProfileDir(data), join(data, 'profiles', 'work'))
  writeFileSync(join(data, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: '../elsewhere' }))
  assert.equal(activeProfileDir(data), join(data, 'profiles', 'local-default'))
})

test('the default agent comes from profile-state.db, else orca-data.json, else claude', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'agent-inbox-profile-'))
  const failing = async () => {
    throw new Error('no sqlite3')
  }
  assert.equal(await defaultAgent(profile, failing), 'claude')
  writeFileSync(join(profile, 'orca-data.json'), JSON.stringify({ settings: { defaultTuiAgent: 'codex' } }))
  assert.equal(await defaultAgent(profile, failing), 'codex')
  // a database it cannot query falls through to the data file
  writeFileSync(join(profile, 'profile-state.db'), '')
  assert.equal(await defaultAgent(profile, failing), 'codex')
  assert.equal(await defaultAgent(profile, async () => 'gemini\n'), 'gemini')
  assert.equal(await defaultAgent(profile, async () => '\n'), 'codex')
  assert.equal(await defaultAgent(profile, async () => 'rm -rf /\n'), 'codex')
})

test('reads the settings document of a real profile-state.db', { skip: !hasSqlite }, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'agent-inbox-profile-'))
  mkdirSync(profile, { recursive: true })
  execFileSync('sqlite3', [
    join(profile, 'profile-state.db'),
    `create table profile_state_documents (domain text primary key not null, payload text not null);
     insert into profile_state_documents values ('settings', '{"defaultTuiAgent":"opencode","theme":"dark"}');`
  ])
  assert.equal(await defaultAgent(profile, sqlite), 'opencode')
})

test('the selected workspace is the active one in orca worktree ps', () => {
  assert.equal(activeWorkspace([{ path: '/a', isActive: false }, { path: '/b', isActive: true }]), '/b')
  assert.equal(activeWorkspace([{ path: '/a' }]), null)
  assert.equal(activeWorkspace([]), null)
})
