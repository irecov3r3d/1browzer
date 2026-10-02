/**
 * Zod-facing session IPC actions (testable without Electron).
 */

import type {
  IpcError,
  SessionClearResponse,
  SessionListResponse,
  SessionLoadResponse
} from '../../shared'
import type { SessionStore } from './types'

export function actionSessionList(
  store: SessionStore
): SessionListResponse {
  const sessions = store.listSessions().map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    turnCount: s.turnCount,
    preview: s.preview
  }))
  return { ok: true, backend: store.backend, sessions }
}

export function actionSessionLoad(
  store: SessionStore,
  opts: { sessionId?: string } = {}
): SessionLoadResponse | IpcError {
  const record = opts.sessionId
    ? store.loadSession(opts.sessionId)
    : store.loadLastSession()

  if (opts.sessionId && !record) {
    return {
      ok: false,
      error: `Session not found: ${opts.sessionId}`,
      code: 'NOT_FOUND'
    }
  }

  return {
    ok: true,
    backend: store.backend,
    session: record
      ? {
          id: record.id,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          turns: record.turns.map((t) => ({
            id: t.id,
            role: t.role,
            text: t.text,
            ts: t.ts,
            ...(t.stub !== undefined ? { stub: t.stub } : {})
          }))
        }
      : null
  }
}

export function actionSessionClear(
  store: SessionStore,
  opts: { sessionId?: string; clearAll?: boolean } = {}
): SessionClearResponse | IpcError {
  if (opts.clearAll === true) {
    const n = store.listSessions().length
    store.clearAll()
    return { ok: true, cleared: n }
  }

  if (!opts.sessionId) {
    return {
      ok: false,
      error: 'Provide sessionId or clearAll: true',
      code: 'VALIDATION'
    }
  }

  const ok = store.clearSession(opts.sessionId)
  if (!ok) {
    return {
      ok: false,
      error: `Session not found: ${opts.sessionId}`,
      code: 'NOT_FOUND'
    }
  }
  return { ok: true, cleared: 1 }
}
