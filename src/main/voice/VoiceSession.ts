/**
 * Main-process voice session orchestrator.
 * Binds conceptually to one Active Worker tab; forwards PCM to GeminiLiveClient;
 * pushes status / transcript / pcmOut events to the dashboard renderer.
 *
 * Phase 5: synchronous tool loop — voice uplink pauses while tools run;
 * functionDeclarations are attached on connect; results return via sendToolResponse.
 * Transcript turns are persisted via SessionStore when configured.
 */

import type { BrowserWindow } from 'electron'
import {
  GEMINI_LIVE_MODEL,
  IPC_CHANNELS,
  VOICE_INPUT_SAMPLE_RATE_HZ,
  VOICE_OUTPUT_SAMPLE_RATE_HZ,
  type VoiceEvent,
  type VoiceSessionState
} from '../../shared'
import type { MockableTabManager } from '../ipc/tabActions'
import type { SessionStore } from '../session'
import { hasGeminiApiKey, resolveGeminiApiKey } from './apiKey'
import { buildBrowserTools } from './browserTools'
import { MockGeminiLiveClient } from './MockGeminiLiveClient'
import { SdkGeminiLiveClient } from './SdkGeminiLiveClient'
import { routeBrowserToolCalls } from './toolRouter'
import type { GeminiLiveClient, VoiceSessionSnapshot } from './types'

export type VoiceSessionDeps = {
  /** Factory so tests can inject MockGeminiLiveClient without network. */
  createClient?: () => GeminiLiveClient
  /** When true (default in tests via env), never touch the real SDK. */
  preferMock?: boolean
  /** Tab manager for capability-gated tool execution (Phase 5). */
  tabManager?: MockableTabManager
  /** Durable chat/transcript store (Phase 5). */
  sessionStore?: SessionStore
}

export class VoiceSession {
  private state: VoiceSessionState = 'idle'
  private tabId: string | null = null
  private model: string | null = null
  private sessionHandle: string | null = null
  private lastError: string | null = null
  private client: GeminiLiveClient | null = null
  private dashboard: BrowserWindow | null = null
  private readonly deps: VoiceSessionDeps
  /**
   * Synchronous tool loop flag — while true, uplink PCM is dropped so voice
   * effectively pauses during tool execution (ARCHITECTURE.md Phase 5).
   */
  private toolLoopActive = false
  private chatSessionId: string | null = null

  constructor(deps: VoiceSessionDeps = {}) {
    this.deps = deps
  }

  setDashboard(win: BrowserWindow | null): void {
    this.dashboard = win
  }

  setTabManager(manager: MockableTabManager | undefined): void {
    this.deps.tabManager = manager
  }

  setSessionStore(store: SessionStore | undefined): void {
    this.deps.sessionStore = store
  }

  getSnapshot(): VoiceSessionSnapshot {
    return {
      state: this.state,
      tabId: this.tabId,
      model: this.model,
      sessionHandle: this.sessionHandle,
      lastError: this.lastError
    }
  }

  /** Current durable chat session id (created on voice start when store is set). */
  getChatSessionId(): string | null {
    return this.chatSessionId
  }

  isToolLoopActive(): boolean {
    return this.toolLoopActive
  }

  hasApiKey(): boolean {
    return hasGeminiApiKey()
  }

  private setState(state: VoiceSessionState, detail?: string): void {
    this.state = state
    this.emit({
      type: 'status',
      state,
      tabId: this.tabId,
      ...(detail ? { detail } : {})
    })
  }

  private emit(event: VoiceEvent): void {
    // Persist transcript turns when a chat session exists.
    if (event.type === 'transcript' && this.deps.sessionStore && this.chatSessionId) {
      try {
        const role =
          event.role === 'user'
            ? 'user'
            : event.role === 'model'
              ? 'model'
              : 'system'
        this.deps.sessionStore.appendTurn(this.chatSessionId, {
          role,
          text: event.text,
          ts: Date.now(),
          ...(event.stub ? { stub: true } : {})
        })
      } catch {
        // Persistence must not break the live voice path.
      }
    }

    const win = this.dashboard
    if (!win || win.isDestroyed()) return
    win.webContents.send(IPC_CHANNELS.VOICE_EVENT, event)
  }

  private makeClient(): GeminiLiveClient {
    if (this.deps.createClient) return this.deps.createClient()
    const forceMock =
      this.deps.preferMock === true ||
      process.env.ONEBROWZER_VOICE_MOCK === '1'
    if (forceMock) return new MockGeminiLiveClient()
    return new SdkGeminiLiveClient()
  }

  /**
   * Start Live session for an already-gated Active tab.
   * Caller must enforce capability + API key before invoking.
   */
  async start(opts: {
    tabId: string
    resume?: boolean
  }): Promise<{ resumed: boolean; model: string }> {
    if (this.state === 'live' || this.state === 'connecting') {
      await this.stop()
    }

    const apiKey = resolveGeminiApiKey()
    const useMock =
      this.deps.preferMock === true ||
      process.env.ONEBROWZER_VOICE_MOCK === '1' ||
      Boolean(this.deps.createClient)

    // Real path requires a key; mock path does not.
    if (!useMock && !apiKey) {
      const err = new Error('GEMINI_API_KEY is not set')
      ;(err as Error & { code: string }).code = 'NO_API_KEY'
      throw err
    }

    this.tabId = opts.tabId
    this.lastError = null
    this.toolLoopActive = false
    this.model =
      process.env.GEMINI_LIVE_MODEL?.trim() || GEMINI_LIVE_MODEL
    this.setState('connecting')

    // Ensure a durable chat session for transcript persistence.
    if (this.deps.sessionStore) {
      try {
        this.chatSessionId = this.deps.sessionStore.createSession()
      } catch {
        this.chatSessionId = null
      }
    }

    const client = this.makeClient()
    this.client = client
    this.wireClient(client)

    const handle =
      opts.resume !== false && this.sessionHandle
        ? this.sessionHandle
        : null
    const resumed = Boolean(handle)

    const tools = buildBrowserTools()

    try {
      await client.connect({
        apiKey: apiKey ?? 'mock-key',
        model: this.model,
        sessionHandle: handle,
        tools
      })
      this.setState('live', resumed ? 'resumed' : 'fresh')
      this.emit({
        type: 'transcript',
        role: 'system',
        text: resumed
          ? `Voice session resumed on Active tab ${opts.tabId.slice(0, 8)}… (tools bound)`
          : `Voice session started on Active tab ${opts.tabId.slice(0, 8)}… (tools bound)`,
        stub: client.kind === 'mock'
      })
      return { resumed, model: this.model }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.setState('error', this.lastError)
      this.client = null
      throw err
    }
  }

  private wireClient(client: GeminiLiveClient): void {
    client.on('audio', (pcmBase64, sampleRateHz) => {
      // Drop model audio while tools run — keeps the sync tool loop clean.
      if (this.toolLoopActive) return
      this.emit({
        type: 'pcmOut',
        pcmBase64,
        sampleRateHz: sampleRateHz || VOICE_OUTPUT_SAMPLE_RATE_HZ
      })
    })
    client.on('transcript', (role, text) => {
      this.emit({ type: 'transcript', role, text })
    })
    client.on('sessionResumption', (handle, resumable) => {
      if (resumable && handle) {
        this.sessionHandle = handle
      }
    })
    client.on('goAway', () => {
      // Transparent resumption: next start() will pass sessionHandle.
      this.emit({
        type: 'transcript',
        role: 'system',
        text: 'Server GoAway — session handle retained for resumption'
      })
    })
    client.on('error', (err) => {
      this.lastError = err.message
      this.emit({ type: 'error', error: err.message, code: 'VOICE' })
      this.setState('error', err.message)
    })
    client.on('close', (reason) => {
      if (this.state === 'stopping') {
        this.setState('idle', reason)
      } else if (this.state === 'live' || this.state === 'connecting') {
        this.setState('idle', reason || 'closed')
      }
      this.client = null
      this.toolLoopActive = false
    })
    client.on('toolCall', (payload) => {
      void this.handleToolCall(payload)
    })
  }

  /**
   * Synchronous tool loop (ARCHITECTURE.md):
   * pause uplink → execute capability-gated tools on Active tab →
   * sendToolResponse → resume uplink.
   */
  private async handleToolCall(payload: unknown): Promise<void> {
    const client = this.client
    const tabId = this.tabId
    const manager = this.deps.tabManager

    this.toolLoopActive = true
    this.emit({
      type: 'transcript',
      role: 'system',
      text: 'Tool loop: voice paused while browser tools execute…'
    })

    try {
      if (!client || !tabId) {
        client?.sendToolResponse([
          {
            name: 'unknown',
            response: {
              ok: false,
              error: 'No active voice tab for tool execution',
              code: 'NOT_FOUND'
            }
          }
        ])
        return
      }

      if (!manager) {
        client.sendToolResponse([
          {
            name: 'unknown',
            response: {
              ok: false,
              error: 'Tab manager not wired for tools',
              code: 'INTERNAL'
            }
          }
        ])
        return
      }

      const { functionResponses, summaries } = await routeBrowserToolCalls(
        manager,
        tabId,
        payload
      )

      this.emit({
        type: 'transcript',
        role: 'system',
        text: `Tools: ${summaries.join('; ')}`
      })

      // Persist tool results as tool-role turns when possible.
      if (this.deps.sessionStore && this.chatSessionId) {
        try {
          this.deps.sessionStore.appendTurn(this.chatSessionId, {
            role: 'tool',
            text: summaries.join('; ').slice(0, 4000),
            ts: Date.now()
          })
        } catch {
          // ignore
        }
      }

      client.sendToolResponse(functionResponses)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({
        type: 'transcript',
        role: 'system',
        text: `Tool loop error: ${message}`
      })
      try {
        client?.sendToolResponse([
          {
            name: 'unknown',
            response: { ok: false, error: message, code: 'INTERNAL' }
          }
        ])
      } catch {
        // ignore
      }
    } finally {
      this.toolLoopActive = false
      this.emit({
        type: 'transcript',
        role: 'system',
        text: 'Tool loop complete — voice uplink resumed'
      })
    }
  }

  /**
   * Uplink mic PCM from renderer (16 kHz Int16 LE base64).
   * Dropped while the synchronous tool loop is active (voice pause).
   */
  sendPcmIn(pcmBase64: string, sampleRateHz?: number): void {
    if (!this.client || this.state !== 'live') return
    if (this.toolLoopActive) return
    void sampleRateHz
    this.client.sendAudioPcm(pcmBase64)
  }

  /**
   * VAD barge-in: flush playback on renderer (via event) + activityEnd to model.
   */
  interrupt(reason = 'vad'): boolean {
    if (!this.client || (this.state !== 'live' && this.state !== 'connecting')) {
      return false
    }
    this.client.sendActivityEnd()
    this.emit({ type: 'interrupted', reason })
    return true
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' && !this.client) {
      return
    }
    this.setState('stopping')
    this.toolLoopActive = false
    try {
      this.client?.close()
    } finally {
      this.client = null
      this.tabId = null
      this.setState('idle')
    }
  }
}

export { VOICE_INPUT_SAMPLE_RATE_HZ }
