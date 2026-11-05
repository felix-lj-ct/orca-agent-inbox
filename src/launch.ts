// Where the agent for Wired points' Add a point, Align and Remove starts: Orca's default agent, in the workspace
// selected in Orca. The orca CLI needs an agent id and Orca does not tell plugins its default, so it is read
// from Orca's profile state, read-only: the settings document of profile-state.db (SQLite) of the active
// profile, else the older orca-data.json; claude when neither says.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const FALLBACK_AGENT = 'claude'

/** Orca's own data folder (Electron's userData for the app name "orca"). */
export function orcaDataDir(home: string, platform: string, env: Record<string, string | undefined> = {}): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'orca')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'orca')
}

/** The folder of the profile Orca has open; local-default when the index cannot say. */
export function activeProfileDir(dataDir: string): string {
  let id = 'local-default'
  try {
    const index = JSON.parse(readFileSync(join(dataDir, 'orca-profile-index.json'), 'utf8'))
    if (typeof index.activeProfileId === 'string' && /^[\w.-]+$/.test(index.activeProfileId)) id = index.activeProfileId
  } catch {
    // no index: a single-profile install
  }
  return join(dataDir, 'profiles', id)
}

const agentId = (value: unknown) => (typeof value === 'string' && /^[\w.-]{1,64}$/.test(value.trim()) ? value.trim() : null)

/**
 * Orca's default agent. `query` runs the sqlite3 CLI on the database read-only and returns what it printed;
 * it throws when sqlite3 is missing or the database cannot be read, which falls through to the next source.
 */
export async function defaultAgent(profileDir: string, query: (db: string, sql: string) => Promise<string>): Promise<string> {
  const db = join(profileDir, 'profile-state.db')
  if (existsSync(db)) {
    try {
      const id = agentId(await query(db, "select json_extract(payload, '$.defaultTuiAgent') from profile_state_documents where domain = 'settings'"))
      if (id) return id
    } catch {
      // no sqlite3, or a schema this does not know
    }
  }
  try {
    const id = agentId(JSON.parse(readFileSync(join(profileDir, 'orca-data.json'), 'utf8')).settings?.defaultTuiAgent)
    if (id) return id
  } catch {
    // no older data file either
  }
  return FALLBACK_AGENT
}

/** The path of the workspace selected in Orca, from `orca worktree ps`; null when none is. */
export function activeWorkspace(worktrees: { path?: unknown; isActive?: unknown }[]): string | null {
  const active = worktrees.find((w) => w.isActive === true && typeof w.path === 'string' && w.path)
  return active ? (active.path as string) : null
}
