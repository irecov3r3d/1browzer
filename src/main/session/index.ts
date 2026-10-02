/**
 * SessionStore factory — prefer sql.js SQLite; fall back to JSON file.
 * better-sqlite3 could not be built here (missing `make`); sql.js provides
 * real SQLite via WASM without native compilation.
 */

import { join } from 'path'
import { createJsonSessionStore, createMemorySessionStore } from './jsonStore'
import { createSqliteSessionStore } from './sqliteStore'
import type { SessionStore } from './types'

export type {
  SessionStore,
  SessionStoreBackend,
  SessionRecord,
  SessionSummary,
  TranscriptTurn,
  TranscriptRole
} from './types'
export { createJsonSessionStore, createMemorySessionStore } from './jsonStore'
export { createSqliteSessionStore } from './sqliteStore'

export type OpenSessionStoreResult = {
  store: SessionStore
  path: string
  backend: SessionStore['backend']
}

/**
 * Open a durable session store under `userDataDir`.
 * Tries sql.js SQLite first; on failure uses JSON beside the intended db path.
 */
export async function openSessionStore(
  userDataDir: string
): Promise<OpenSessionStoreResult> {
  const sqlitePath = join(userDataDir, '1browzer-sessions.sqlite')
  const jsonPath = join(userDataDir, '1browzer-sessions.json')

  try {
    const store = await createSqliteSessionStore(sqlitePath)
    return { store, path: sqlitePath, backend: 'sqlite' }
  } catch (err) {
    console.warn(
      '[1browzer] sql.js SessionStore init failed; using JSON fallback:',
      err instanceof Error ? err.message : err
    )
    const store = createJsonSessionStore(jsonPath)
    return { store, path: jsonPath, backend: 'json' }
  }
}

export {
  actionSessionList,
  actionSessionLoad,
  actionSessionClear
} from './sessionActions'
