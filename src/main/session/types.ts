/**
 * Chat / voice session persistence surface (Phase 5).
 * SQLite (sql.js) preferred; JSON file fallback behind the same interface.
 */

export type TranscriptRole = 'user' | 'model' | 'system' | 'tool'

export type TranscriptTurn = {
  id: string
  role: TranscriptRole
  text: string
  ts: number
  stub?: boolean
}

export type SessionSummary = {
  id: string
  createdAt: number
  updatedAt: number
  turnCount: number
  preview: string
}

export type SessionRecord = {
  id: string
  createdAt: number
  updatedAt: number
  turns: TranscriptTurn[]
}

export type SessionStoreBackend = 'sqlite' | 'json'

export type SessionStore = {
  readonly backend: SessionStoreBackend
  /** Create a new empty session; returns its id. */
  createSession(id?: string): string
  listSessions(): SessionSummary[]
  loadSession(id: string): SessionRecord | null
  /** Most recently updated session, if any. */
  loadLastSession(): SessionRecord | null
  appendTurn(sessionId: string, turn: Omit<TranscriptTurn, 'id'> & { id?: string }): TranscriptTurn
  /** Destructive: delete one session and its turns. */
  clearSession(id: string): boolean
  /** Destructive: wipe all sessions. */
  clearAll(): void
  close(): void
}
