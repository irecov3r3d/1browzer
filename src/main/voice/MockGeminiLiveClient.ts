import type {
  GeminiLiveClient,
  GeminiLiveClientEvents,
  GeminiLiveConnectOptions
} from './types'

type HandlerMap = {
  [K in keyof GeminiLiveClientEvents]?: Set<GeminiLiveClientEvents[K]>
}

/**
 * In-memory Live client for unit tests — never opens a network socket.
 * Echoes a tiny silence PCM chunk after connect so the audio pipeline can be exercised.
 */
export class MockGeminiLiveClient implements GeminiLiveClient {
  readonly kind = 'mock' as const
  connected = false
  lastOpts: GeminiLiveConnectOptions | null = null
  audioChunks: string[] = []
  activityEndCount = 0
  toolResponses: Array<{
    id?: string
    name: string
    response: Record<string, unknown>
  }> = []
  private handlers: HandlerMap = {}

  on<K extends keyof GeminiLiveClientEvents>(
    event: K,
    handler: GeminiLiveClientEvents[K]
  ): void {
    if (!this.handlers[event]) {
      this.handlers[event] = new Set() as HandlerMap[K]
    }
    ;(this.handlers[event] as Set<GeminiLiveClientEvents[K]>).add(handler)
  }

  off<K extends keyof GeminiLiveClientEvents>(
    event: K,
    handler: GeminiLiveClientEvents[K]
  ): void {
    this.handlers[event]?.delete(handler)
  }

  private emit<K extends keyof GeminiLiveClientEvents>(
    event: K,
    ...args: Parameters<GeminiLiveClientEvents[K]>
  ): void {
    const set = this.handlers[event]
    if (!set) return
    for (const h of set) {
      ;(h as (...a: unknown[]) => void)(...args)
    }
  }

  async connect(opts: GeminiLiveConnectOptions): Promise<void> {
    this.lastOpts = opts
    this.connected = true
    this.emit('open')
    // Stub transcript so the dashboard log has something without a live key.
    this.emit(
      'transcript',
      'model',
      '[mock] Gemini Live session connected (no network)'
    )
    // 20 ms of silence at 24 kHz Int16 → 960 bytes → base64
    const silence = Buffer.alloc(960, 0).toString('base64')
    this.emit('audio', silence, 24_000)
    if (opts.sessionHandle) {
      this.emit('sessionResumption', opts.sessionHandle, true)
    } else {
      this.emit('sessionResumption', 'mock-handle-1', true)
    }
  }

  sendAudioPcm(pcmBase64: string, _mimeType?: string): void {
    if (!this.connected) return
    this.audioChunks.push(pcmBase64)
  }

  sendActivityEnd(): void {
    if (!this.connected) return
    this.activityEndCount += 1
  }

  sendToolResponse(
    functionResponses: Array<{
      id?: string
      name: string
      response: Record<string, unknown>
    }>
  ): void {
    if (!this.connected) return
    this.toolResponses.push(...functionResponses)
  }

  /** Test helper: emit a synthetic toolCall as the Live server would. */
  emitToolCall(payload: unknown): void {
    if (!this.connected) return
    this.emit('toolCall', payload)
  }

  close(): void {
    if (!this.connected) return
    this.connected = false
    this.emit('close', 'mock-close')
  }
}
