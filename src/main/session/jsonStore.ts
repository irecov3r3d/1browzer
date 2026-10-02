/**
 * JSON-file SessionStore — always available (no native / WASM deps).
 * Fallback when sql.js cannot initialize; also used for fast unit tests.
 */

import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type {
  SessionRecord,
  SessionStore,
  SessionSummary,
  TranscriptTurn
} from './types'

type DiskShape = { sessions: SessionRecord[] }

function emptyDisk(): DiskShape {
  return { sessions: [] }
}

function toSummary(s: SessionRecord): SessionSummary {
  return {
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    turnCount: s.turns.length,
    preview: s.turns.length > 0 ? s.turns[s.turns.length - 1]!.text.slice(0, 120) : ''
  }
}

export function createJsonSessionStore(filePath: string): SessionStore {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  let data: DiskShape = emptyDisk()
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as DiskShape
      if (parsed && Array.isArray(parsed.sessions)) data = parsed
    } catch {
      data = emptyDisk()
    }
  }

  const persist = (): void => {
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  const store: SessionStore = {
    backend: 'json',

    createSession(id?: string): string {
      const now = Date.now()
      const session: SessionRecord = {
        id: id ?? randomUUID(),
        createdAt: now,
        updatedAt: now,
        turns: []
      }
      data.sessions.unshift(session)
      persist()
      return session.id
    },

    listSessions(): SessionSummary[] {
      return data.sessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(toSummary)
    },

    loadSession(id: string): SessionRecord | null {
      const s = data.sessions.find((x) => x.id === id)
      return s ? structuredClone(s) : null
    },

    loadLastSession(): SessionRecord | null {
      const list = store.listSessions()
      if (list.length === 0) return null
      return store.loadSession(list[0]!.id)
    },

    appendTurn(sessionId, turn): TranscriptTurn {
      const s = data.sessions.find((x) => x.id === sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      const full: TranscriptTurn = {
        id: turn.id ?? randomUUID(),
        role: turn.role,
        text: turn.text.slice(0, 4000),
        ts: turn.ts,
        ...(turn.stub !== undefined ? { stub: turn.stub } : {})
      }
      s.turns.push(full)
      s.updatedAt = full.ts
      persist()
      return full
    },

    clearSession(id: string): boolean {
      const before = data.sessions.length
      data.sessions = data.sessions.filter((s) => s.id !== id)
      if (data.sessions.length === before) return false
      persist()
      return true
    },

    clearAll(): void {
      data = emptyDisk()
      persist()
    },

    close(): void {
      // no-op
    }
  }

  return store
}

/** In-memory store for unit tests (no disk I/O). */
export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionRecord>()

  const store: SessionStore = {
    backend: 'json',

    createSession(id?: string): string {
      const now = Date.now()
      const session: SessionRecord = {
        id: id ?? randomUUID(),
        createdAt: now,
        updatedAt: now,
        turns: []
      }
      sessions.set(session.id, session)
      return session.id
    },

    listSessions(): SessionSummary[] {
      return [...sessions.values()]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(toSummary)
    },

    loadSession(id: string): SessionRecord | null {
      const s = sessions.get(id)
      return s ? structuredClone(s) : null
    },

    loadLastSession(): SessionRecord | null {
      const list = store.listSessions()
      if (list.length === 0) return null
      return store.loadSession(list[0]!.id)
    },

    appendTurn(sessionId, turn): TranscriptTurn {
      const s = sessions.get(sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      const full: TranscriptTurn = {
        id: turn.id ?? randomUUID(),
        role: turn.role,
        text: turn.text.slice(0, 4000),
        ts: turn.ts,
        ...(turn.stub !== undefined ? { stub: turn.stub } : {})
      }
      s.turns.push(full)
      s.updatedAt = full.ts
      return full
    },

    clearSession(id: string): boolean {
      return sessions.delete(id)
    },

    clearAll(): void {
      sessions.clear()
    },

    close(): void {
      sessions.clear()
    }
  }

  return store
}
