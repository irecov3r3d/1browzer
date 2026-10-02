/**
 * Clean Gemini Live client surface.
 * Real SDK implementation talks to Google; MockGeminiLiveClient is for unit tests
 * (no network). Phase 5 will add tool declarations on connect.
 */

import type { VoiceSessionState } from '../../shared'

export type GeminiLiveConnectOptions = {
  apiKey: string
  model: string
  /** Previous SessionResumptionUpdate handle, if any. */
  sessionHandle?: string | null
  /**
   * Phase 5: Gemini functionDeclarations / tools.
   * Phase 4 leaves this empty (stub placeholder only).
   */
  tools?: unknown[]
}

export type GeminiLiveClientEvents = {
  open: () => void
  /** Raw PCM Int16 LE base64 from the model (typically 24 kHz). */
  audio: (pcmBase64: string, sampleRateHz: number) => void
  /** Optional transcript fragments when the server provides them. */
  transcript: (role: 'user' | 'model', text: string) => void
  /** Persist for reconnect after GoAway (~T-60s of ~10 min WS lifetime). */
  sessionResumption: (handle: string | null, resumable: boolean) => void
  /** Server asks client to wrap up before disconnect. */
  goAway: (timeLeftMs?: number) => void
  error: (err: Error) => void
  close: (reason?: string) => void
  /**
   * Phase 5 handoff: model requested a tool call.
   * Phase 4 stubs this — log / ignore until tool binding lands.
   */
  toolCall: (payload: unknown) => void
}

export type GeminiLiveClient = {
  readonly kind: 'sdk' | 'mock'
  connect(opts: GeminiLiveConnectOptions): Promise<void>
  /** Send uplink PCM (16 kHz Int16 LE base64). */
  sendAudioPcm(pcmBase64: string, mimeType?: string): void
  /**
   * Barge-in: signal end of user activity / flush model generation.
   * Maps to realtimeInput.activityEnd (+ optional audioStreamEnd).
   */
  sendActivityEnd(): void
  /**
   * Reply to a Live toolCall with function responses (Phase 5).
   * Maps to Session.sendToolResponse({ functionResponses }).
   */
  sendToolResponse(functionResponses: Array<{
    id?: string
    name: string
    response: Record<string, unknown>
  }>): void
  close(): void
  on<K extends keyof GeminiLiveClientEvents>(
    event: K,
    handler: GeminiLiveClientEvents[K]
  ): void
  off<K extends keyof GeminiLiveClientEvents>(
    event: K,
    handler: GeminiLiveClientEvents[K]
  ): void
}

export type VoiceSessionSnapshot = {
  state: VoiceSessionState
  tabId: string | null
  model: string | null
  sessionHandle: string | null
  lastError: string | null
}
