/**
 * Gemini Multimodal Live constants (ARCHITECTURE.md Phase 4).
 */

/** Model id from the architectural brief (verify against current Google docs when connecting). */
export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview'

/** Mic capture / uplink sample rate expected by Live (PCM Int16 LE). */
export const VOICE_INPUT_SAMPLE_RATE_HZ = 16_000

/** Model audio downlink sample rate (PCM Int16 LE). */
export const VOICE_OUTPUT_SAMPLE_RATE_HZ = 24_000

export const VOICE_PCM_MIME_IN = 'audio/pcm;rate=16000'
export const VOICE_PCM_MIME_OUT = 'audio/pcm;rate=24000'

export const VOICE_SESSION_STATES = [
  'idle',
  'connecting',
  'live',
  'reconnecting',
  'stopping',
  'error'
] as const

export type VoiceSessionState = (typeof VOICE_SESSION_STATES)[number]
