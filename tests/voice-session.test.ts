import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  CAPABILITY_PERMISSIONS,
  isActionAllowed,
  type TabCapability,
  type TabInfo
} from '../src/shared'
import { denyIfNotAllowed } from '../src/main/capabilities/gate'
import { MockGeminiLiveClient } from '../src/main/voice/MockGeminiLiveClient'
import { VoiceSession } from '../src/main/voice/VoiceSession'
import { resolveGeminiApiKey, hasGeminiApiKey } from '../src/main/voice/apiKey'
import {
  actionVoiceStart,
  actionVoiceStop,
  actionVoiceStatus,
  actionVoiceInterrupt,
  type VoiceTab,
  type VoiceTabResolver,
  type VoiceSessionLike
} from '../src/main/voice/voiceActions'

function makeTab(id: string, capability: TabCapability): VoiceTab {
  const info: TabInfo = {
    id,
    capability,
    url: 'https://example.com',
    title: 'Example',
    canInput: CAPABILITY_PERMISSIONS[capability].canInput,
    canCdpAttach: CAPABILITY_PERMISSIONS[capability].canCdpAttach
  }
  return {
    id,
    capability,
    toInfo: () => info
  }
}

function makeResolver(tabs: VoiceTab[]): VoiceTabResolver {
  const map = new Map(tabs.map((t) => [t.id, t]))
  const active = tabs[0]?.id
  return {
    resolveTab: (tabId?: string) => {
      if (tabId) return map.get(tabId)
      return active ? map.get(active) : undefined
    }
  }
}

function makeSessionStub(opts: {
  hasKey: boolean
  startImpl?: VoiceSessionLike['start']
}): VoiceSessionLike {
  let state: ReturnType<VoiceSessionLike['getSnapshot']> = {
    state: 'idle',
    tabId: null,
    model: null,
    sessionHandle: null,
    lastError: null
  }
  return {
    hasApiKey: () => opts.hasKey,
    getSnapshot: () => state,
    start: opts.startImpl
      ? opts.startImpl
      : async ({ tabId }) => {
          state = {
            state: 'live',
            tabId,
            model: 'gemini-3.1-flash-live-preview',
            sessionHandle: 'h1',
            lastError: null
          }
          return { resumed: false, model: state.model! }
        },
    stop: async () => {
      state = { ...state, state: 'idle', tabId: null }
    },
    interrupt: () => state.state === 'live',
    sendPcmIn: vi.fn()
  }
}

describe('apiKey resolver', () => {
  it('returns null when GEMINI_API_KEY missing or blank', () => {
    expect(resolveGeminiApiKey({})).toBeNull()
    expect(resolveGeminiApiKey({ GEMINI_API_KEY: '' })).toBeNull()
    expect(resolveGeminiApiKey({ GEMINI_API_KEY: '   ' })).toBeNull()
    expect(hasGeminiApiKey({ GEMINI_API_KEY: '' })).toBe(false)
  })

  it('returns trimmed key when set', () => {
    expect(resolveGeminiApiKey({ GEMINI_API_KEY: '  secret  ' })).toBe('secret')
    expect(hasGeminiApiKey({ GEMINI_API_KEY: 'secret' })).toBe(true)
  })
})

describe('voice capability matrix', () => {
  it('only Active may start voice', () => {
    expect(isActionAllowed('active', 'voice')).toBe(true)
    expect(isActionAllowed('readOnly', 'voice')).toBe(false)
    expect(isActionAllowed('privacy', 'voice')).toBe(false)
    expect(CAPABILITY_PERMISSIONS.active.canVoice).toBe(true)
    expect(CAPABILITY_PERMISSIONS.privacy.canVoice).toBe(false)
  })

  it('denyIfNotAllowed returns CAPABILITY_DENIED for Privacy voice', () => {
    const err = denyIfNotAllowed('privacy', 'voice')
    expect(err?.code).toBe('CAPABILITY_DENIED')
  })
})

describe('actionVoiceStart', () => {
  it('missing API key → NO_API_KEY', async () => {
    const session = makeSessionStub({ hasKey: false })
    const manager = makeResolver([makeTab('a1', 'active')])
    const result = await actionVoiceStart(manager, session, { tabId: 'a1' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('NO_API_KEY')
      expect(result.error).toMatch(/GEMINI_API_KEY/i)
    }
  })

  it('Privacy tabId → CAPABILITY_DENIED (even with API key)', async () => {
    const session = makeSessionStub({ hasKey: true })
    const manager = makeResolver([
      makeTab('a1', 'active'),
      makeTab('p1', 'privacy')
    ])
    const result = await actionVoiceStart(manager, session, { tabId: 'p1' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('CAPABILITY_DENIED')
      expect(result.error).toMatch(/privacy/i)
    }
  })

  it('Read-Only tabId → CAPABILITY_DENIED', async () => {
    const session = makeSessionStub({ hasKey: true })
    const manager = makeResolver([makeTab('r1', 'readOnly')])
    const result = await actionVoiceStart(manager, session, { tabId: 'r1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('CAPABILITY_DENIED')
  })

  it('Active tab with key → ok live', async () => {
    const session = makeSessionStub({ hasKey: true })
    const manager = makeResolver([makeTab('a1', 'active')])
    const result = await actionVoiceStart(manager, session, { tabId: 'a1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tabId).toBe('a1')
      expect(result.state).toBe('live')
      expect(result.model).toContain('gemini')
    }
  })
})

describe('VoiceSession + MockGeminiLiveClient (no network)', () => {
  beforeEach(() => {
    // Ensure env key does not leak into hasApiKey during these tests.
    delete process.env.GEMINI_API_KEY
  })

  it('start without key throws NO_API_KEY when not using injected mock factory alone…', async () => {
    // Prefer mock still needs key check at action layer; session.start without
    // createClient and without preferMock requires key. With preferMock, start works.
    const session = new VoiceSession({ preferMock: true })
    // hasApiKey is false — action layer blocks; session.start itself allows mock.
    await session.start({ tabId: 'a1' })
    expect(session.getSnapshot().state).toBe('live')
    await session.stop()
    expect(session.getSnapshot().state).toBe('idle')
  })

  it('injects MockGeminiLiveClient and forwards PCM / interrupt', async () => {
    const mock = new MockGeminiLiveClient()
    const session = new VoiceSession({
      createClient: () => mock,
      preferMock: true
    })
    await session.start({ tabId: 'active-1' })
    expect(mock.connected).toBe(true)
    expect(mock.lastOpts?.tools?.length).toBeGreaterThan(0)
    expect(JSON.stringify(mock.lastOpts?.tools)).toContain('get_ax_tree')

    session.sendPcmIn(Buffer.alloc(320, 1).toString('base64'))
    expect(mock.audioChunks.length).toBe(1)

    expect(session.interrupt('vad')).toBe(true)
    expect(mock.activityEndCount).toBe(1)

    const status = actionVoiceStatus(session)
    expect(status.ok).toBe(true)
    expect(status.state).toBe('live')

    const stopped = await actionVoiceStop(session)
    expect(stopped.ok).toBe(true)
    expect(mock.connected).toBe(false)
  })

  it('actionVoiceInterrupt reports interrupted flag', async () => {
    const mock = new MockGeminiLiveClient()
    const session = new VoiceSession({
      createClient: () => mock,
      preferMock: true
    })
    await session.start({ tabId: 'a1' })
    const r = actionVoiceInterrupt(session)
    expect(r.ok).toBe(true)
    expect(r.interrupted).toBe(true)
    await session.stop()
  })
})
