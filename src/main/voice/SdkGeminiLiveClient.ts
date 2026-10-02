/**
 * Real Gemini Multimodal Live client via `@google/genai`.
 * Only constructed when a GEMINI_API_KEY is present.
 *
 * Model default: gemini-3.1-flash-live-preview (ARCHITECTURE.md).
 * If Google renames the preview id, override via GEMINI_LIVE_MODEL.
 *
 * SessionResumptionConfig + ContextWindowCompressionConfig are wired on connect.
 * Tools array is accepted but left empty in Phase 4 (Phase 5 binds declarations).
 */

import {
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
  type Session
} from '@google/genai'
import {
  GEMINI_LIVE_MODEL,
  VOICE_PCM_MIME_IN,
  VOICE_OUTPUT_SAMPLE_RATE_HZ
} from '../../shared'
import type {
  GeminiLiveClient,
  GeminiLiveClientEvents,
  GeminiLiveConnectOptions
} from './types'

type HandlerMap = {
  [K in keyof GeminiLiveClientEvents]?: Set<GeminiLiveClientEvents[K]>
}

function extractInlineAudio(
  msg: LiveServerMessage
): { data: string; mimeType?: string } | null {
  const sc = msg.serverContent
  if (!sc?.modelTurn?.parts) return null
  for (const part of sc.modelTurn.parts) {
    const inline = part.inlineData
    if (inline?.data && typeof inline.data === 'string') {
      return { data: inline.data, mimeType: inline.mimeType }
    }
  }
  return null
}

function extractText(
  msg: LiveServerMessage
): { role: 'user' | 'model'; text: string } | null {
  const sc = msg.serverContent
  if (sc?.outputTranscription?.text) {
    return { role: 'model', text: sc.outputTranscription.text }
  }
  if (sc?.inputTranscription?.text) {
    return { role: 'user', text: sc.inputTranscription.text }
  }
  if (sc?.modelTurn?.parts) {
    const texts: string[] = []
    for (const part of sc.modelTurn.parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        texts.push(part.text)
      }
    }
    if (texts.length > 0) return { role: 'model', text: texts.join('') }
  }
  return null
}

export class SdkGeminiLiveClient implements GeminiLiveClient {
  readonly kind = 'sdk' as const
  private session: Session | null = null
  private handlers: HandlerMap = {}
  private closed = false

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
      try {
        ;(h as (...a: unknown[]) => void)(...args)
      } catch {
        // Swallow listener errors so one bad handler cannot tear down the session.
      }
    }
  }

  async connect(opts: GeminiLiveConnectOptions): Promise<void> {
    this.closed = false
    const model =
      process.env.GEMINI_LIVE_MODEL?.trim() || opts.model || GEMINI_LIVE_MODEL

    const ai = new GoogleGenAI({ apiKey: opts.apiKey })

    // SessionResumptionConfig — persist handle from SessionResumptionUpdate;
    // WS lifetime ~10 min with goAway at T-60s (ARCHITECTURE.md).
    const sessionResumption: { handle?: string; transparent: boolean } = {
      transparent: true
    }
    if (opts.sessionHandle) {
      sessionResumption.handle = opts.sessionHandle
    }

    // ContextWindowCompressionConfig — audio ≈ 25 tokens/sec; sliding window
    // keeps long sessions within context (ARCHITECTURE.md).
    const contextWindowCompression = {
      slidingWindow: {}
    }

    this.session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption,
        contextWindowCompression,
        // Phase 5: pass functionDeclarations / tools here.
        ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools as never } : {})
      },
      callbacks: {
        onopen: () => {
          this.emit('open')
        },
        onmessage: (msg: LiveServerMessage) => {
          this.handleMessage(msg)
        },
        onerror: (e: ErrorEvent) => {
          const err =
            e?.error instanceof Error
              ? e.error
              : new Error(e?.message || 'Gemini Live socket error')
          this.emit('error', err)
        },
        onclose: (e: CloseEvent) => {
          this.session = null
          this.emit('close', e?.reason || 'closed')
        }
      }
    })
  }

  private handleMessage(msg: LiveServerMessage): void {
    const audio = extractInlineAudio(msg)
    if (audio) {
      const rate = parseRateFromMime(audio.mimeType) ?? VOICE_OUTPUT_SAMPLE_RATE_HZ
      this.emit('audio', audio.data, rate)
    }

    const text = extractText(msg)
    if (text) {
      this.emit('transcript', text.role, text.text)
    }

    const sru = msg.sessionResumptionUpdate
    if (sru) {
      const handle =
        typeof sru.newHandle === 'string' && sru.newHandle.length > 0
          ? sru.newHandle
          : null
      this.emit('sessionResumption', handle, sru.resumable === true)
    }

    if (msg.goAway) {
      // timeLeft is a duration string from the server (opaque); parse if numeric ms later.
      this.emit('goAway', undefined)
    }

    if (msg.toolCall) {
      // Phase 5: execute declared tools and sendToolResponse.
      this.emit('toolCall', msg.toolCall)
    }
  }

  sendAudioPcm(pcmBase64: string, mimeType: string = VOICE_PCM_MIME_IN): void {
    if (!this.session || this.closed) return
    this.session.sendRealtimeInput({
      audio: {
        data: pcmBase64,
        mimeType
      }
    })
  }

  sendActivityEnd(): void {
    if (!this.session || this.closed) return
    // Barge-in: mark end of user activity so the model stops / yields.
    this.session.sendRealtimeInput({
      activityEnd: {}
    })
    // Also tip the stream end for VAD-driven interrupt paths.
    this.session.sendRealtimeInput({
      audioStreamEnd: true
    })
  }

  sendToolResponse(
    functionResponses: Array<{
      id?: string
      name: string
      response: Record<string, unknown>
    }>
  ): void {
    if (!this.session || this.closed) return
    this.session.sendToolResponse({
      functionResponses: functionResponses.map((fr) => ({
        id: fr.id,
        name: fr.name,
        response: fr.response
      }))
    })
  }

  close(): void {
    this.closed = true
    try {
      this.session?.close()
    } catch {
      // ignore
    }
    this.session = null
  }
}

function parseRateFromMime(mime?: string): number | null {
  if (!mime) return null
  const m = /rate=(\d+)/i.exec(mime)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}
