import { assert, test } from 'orca/testing'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeProfileDir, activeWorkspace, defaultAgent, orcaDataDir, sqliteValue } from './launch'

/** node:sqlite: Orca's runtime has it, a node before 22.13 that runs the tests may not. */
const sqlite = await import('node:sqlite').catch(() => null)

test("Orca's data folder and the active profile in it", () => {
  assert.equal(orcaDataDir('/h', 'darwin'), join('/h', 'Library', 'Application Support', 'orca'))
  assert.equal(orcaDataDir('/h', 'linux'), join('/h', '.config', 'orca'))
  assert.equal(orcaDataDir('/h', 'linux', { XDG_CONFIG_HOME: '/x' }), join('/x', 'orca'))
  assert.equal(orcaDataDir('/h', 'win32'), join('/h', 'AppData', 'Roaming', 'orca'))
  assert.equal(orcaDataDir('/h', 'win32', { APPDATA: '/r' }), join('/r', 'orca'))
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

test('reads the settings document of a real profile-state.db, without the sqlite3 CLI', { skip: !sqlite }, async () => {
  const profile = mkdtempSync(join(tmpdir(), 'agent-inbox-profile-'))
  const db = new sqlite!.DatabaseSync(join(profile, 'profile-state.db'))
  db.exec(`create table profile_state_documents (domain text primary key not null, payload text not null);
           insert into profile_state_documents values ('settings', '{"defaultTuiAgent":"opencode","theme":"dark"}');`)
  db.close()
  const query = async (path: string, sql: string) => (await sqliteValue(path, sql)) ?? ''
  assert.equal(await defaultAgent(profile, query), 'opencode')
  assert.equal(await sqliteValue(join(profile, 'profile-state.db'), "select payload from profile_state_documents where domain = 'none'"), '')
  // a database it cannot read throws, and the next source answers
  writeFileSync(join(profile, 'orca-data.json'), JSON.stringify({ settings: { defaultTuiAgent: 'codex' } }))
  writeFileSync(join(profile, 'profile-state.db'), 'not a database')
  assert.equal(await defaultAgent(profile, query), 'codex')
})

test('the selected workspace is the active one in orca worktree ps', () => {
  assert.equal(activeWorkspace([{ path: '/a', isActive: false }, { path: '/b', isActive: true }]), '/b')
  assert.equal(activeWorkspace([{ path: '/a' }]), null)
  assert.equal(activeWorkspace([]), null)
})
