import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createJsonSessionStore,
  createMemorySessionStore
} from '../src/main/session'

describe('SessionStore round-trip (no network)', () => {
  it('memory store create → append → load → list → clear', () => {
    const store = createMemorySessionStore()
    const id = store.createSession()
    store.appendTurn(id, {
      role: 'user',
      text: 'hello',
      ts: 1000
    })
    store.appendTurn(id, {
      role: 'model',
      text: 'hi there',
      ts: 1001
    })

    const loaded = store.loadSession(id)
    expect(loaded).not.toBeNull()
    expect(loaded!.turns).toHaveLength(2)
    expect(loaded!.turns[0]?.text).toBe('hello')

    const list = store.listSessions()
    expect(list).toHaveLength(1)
    expect(list[0]?.turnCount).toBe(2)
    expect(list[0]?.preview).toContain('hi')

    const last = store.loadLastSession()
    expect(last?.id).toBe(id)

    expect(store.clearSession(id)).toBe(true)
    expect(store.loadSession(id)).toBeNull()
    expect(store.listSessions()).toHaveLength(0)
    store.close()
  })

  it('json file store persists across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), '1browzer-sess-'))
    const file = join(dir, 'sessions.json')
    try {
      const a = createJsonSessionStore(file)
      const id = a.createSession('sess-1')
      a.appendTurn(id, { role: 'system', text: 'boot', ts: 42 })
      a.close()

      const b = createJsonSessionStore(file)
      const loaded = b.loadSession('sess-1')
      expect(loaded?.turns).toHaveLength(1)
      expect(loaded?.turns[0]?.text).toBe('boot')
      b.clearAll()
      expect(b.listSessions()).toHaveLength(0)
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
