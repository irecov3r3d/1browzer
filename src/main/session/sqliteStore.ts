/**
 * sql.js (SQLite WASM) SessionStore — real SQLite without native compile.
 * better-sqlite3 failed on this Linux box (no `make`); sql.js is the preferred
 * SQLite path when native bindings are unavailable.
 */

import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Database } from 'sql.js'
import type InitSqlJs from 'sql.js'
import type {
  SessionRecord,
  SessionStore,
  SessionSummary,
  TranscriptTurn
} from './types'

// electron-vite main is CJS; createRequire from cwd package works in tests + runtime.
const require = createRequire(join(process.cwd(), 'package.json'))

async function loadSqlJs(): Promise<Awaited<ReturnType<typeof InitSqlJs>>> {
  const initSqlJs = require('sql.js') as (opts?: {
    locateFile?: (file: string) => string
  }) => Promise<Awaited<ReturnType<typeof InitSqlJs>>>

  const distDir = dirname(require.resolve('sql.js'))
  const wasmPath = join(distDir, 'sql-wasm.wasm')

  return initSqlJs({
    locateFile: (file: string) =>
      file.endsWith('.wasm') ? wasmPath : join(distDir, file)
  })
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      ts INTEGER NOT NULL,
      stub INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, ts);`
  )
}

function persistDb(db: Database, filePath: string): void {
  const data = db.export()
  writeFileSync(filePath, Buffer.from(data))
}

function queryAll(
  db: Database,
  sql: string,
  params: Array<string | number | null> = []
): unknown[][] {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const rows: unknown[][] = []
    while (stmt.step()) {
      rows.push(stmt.get())
    }
    return rows
  } finally {
    stmt.free()
  }
}

export async function createSqliteSessionStore(
  filePath: string
): Promise<SessionStore> {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const SQL = await loadSqlJs()
  const db: Database = existsSync(filePath)
    ? new SQL.Database(new Uint8Array(readFileSync(filePath)))
    : new SQL.Database()

  migrate(db)
  persistDb(db, filePath)

  const save = (): void => {
    persistDb(db, filePath)
  }

  const store: SessionStore = {
    backend: 'sqlite',

    createSession(id?: string): string {
      const sid = id ?? randomUUID()
      const now = Date.now()
      db.run(
        'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
        [sid, now, now]
      )
      save()
      return sid
    },

    listSessions(): SessionSummary[] {
      const values = queryAll(
        db,
        `
        SELECT s.id, s.created_at, s.updated_at,
          (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turn_count,
          (SELECT t.text FROM turns t WHERE t.session_id = s.id ORDER BY t.ts DESC LIMIT 1) AS preview
        FROM sessions s
        ORDER BY s.updated_at DESC
        `
      )
      return values.map((row) => ({
        id: String(row[0]),
        createdAt: Number(row[1]),
        updatedAt: Number(row[2]),
        turnCount: Number(row[3] ?? 0),
        preview: row[4] != null ? String(row[4]).slice(0, 120) : ''
      }))
    },

    loadSession(id: string): SessionRecord | null {
      const sess = queryAll(
        db,
        'SELECT id, created_at, updated_at FROM sessions WHERE id = ?',
        [id]
      )
      if (sess.length === 0) return null
      const srow = sess[0]!
      const turnRows = queryAll(
        db,
        'SELECT id, role, text, ts, stub FROM turns WHERE session_id = ? ORDER BY ts ASC',
        [id]
      )
      const turns: TranscriptTurn[] = turnRows.map((row) => ({
        id: String(row[0]),
        role: String(row[1]) as TranscriptTurn['role'],
        text: String(row[2]),
        ts: Number(row[3]),
        ...(Number(row[4]) === 1 ? { stub: true } : {})
      }))
      return {
        id: String(srow[0]),
        createdAt: Number(srow[1]),
        updatedAt: Number(srow[2]),
        turns
      }
    },

    loadLastSession(): SessionRecord | null {
      const list = store.listSessions()
      if (list.length === 0) return null
      return store.loadSession(list[0]!.id)
    },

    appendTurn(sessionId, turn): TranscriptTurn {
      const exists = queryAll(db, 'SELECT 1 FROM sessions WHERE id = ?', [
        sessionId
      ])
      if (exists.length === 0) {
        throw new Error(`Session not found: ${sessionId}`)
      }
      const full: TranscriptTurn = {
        id: turn.id ?? randomUUID(),
        role: turn.role,
        text: turn.text.slice(0, 4000),
        ts: turn.ts,
        ...(turn.stub !== undefined ? { stub: turn.stub } : {})
      }
      db.run(
        'INSERT INTO turns (id, session_id, role, text, ts, stub) VALUES (?, ?, ?, ?, ?, ?)',
        [
          full.id,
          sessionId,
          full.role,
          full.text,
          full.ts,
          full.stub ? 1 : 0
        ]
      )
      db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [
        full.ts,
        sessionId
      ])
      save()
      return full
    },

    clearSession(id: string): boolean {
      const exists = queryAll(db, 'SELECT 1 FROM sessions WHERE id = ?', [id])
      if (exists.length === 0) return false
      db.run('DELETE FROM turns WHERE session_id = ?', [id])
      db.run('DELETE FROM sessions WHERE id = ?', [id])
      save()
      return true
    },

    clearAll(): void {
      db.run('DELETE FROM turns')
      db.run('DELETE FROM sessions')
      save()
    },

    close(): void {
      save()
      db.close()
    }
  }

  return store
}
