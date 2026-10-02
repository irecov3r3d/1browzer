/**
 * Shared IPC channel names and payload size limits.
 * Keep channel strings here so Main, Preload, and Renderer stay in sync.
 */

export const IPC_CHANNELS = {
  PING: 'app:ping',
  TABS_LIST: 'tabs:list',
  TABS_CREATE: 'tabs:create',
  TABS_SET_ACTIVE: 'tabs:setActive',
  TABS_CLOSE: 'tabs:close',
  TABS_OPEN_PRIVACY: 'tabs:openPrivacy',
  CDP_GET_AX_TREE: 'cdp:getAxTree',
  CDP_HIGHLIGHT_NODE: 'cdp:highlightNode',
  CDP_NAVIGATE: 'cdp:navigate',
  /** Start Gemini Live voice session (Active tab only). */
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_STATUS: 'voice:status',
  /** Renderer → Main: PCM mic frame (base64 Int16 LE). */
  VOICE_PCM_IN: 'voice:pcmIn',
  /** Renderer → Main: barge-in / activity end. */
  VOICE_INTERRUPT: 'voice:interrupt',
  /** Main → Renderer push events (status, transcript, pcmOut). */
  VOICE_EVENT: 'voice:event',
  /** List persisted chat/voice sessions. */
  SESSION_LIST: 'session:list',
  /** Load one session (turns + metadata). */
  SESSION_LOAD: 'session:load',
  /** Destructive clear of one or all sessions. */
  SESSION_CLEAR: 'session:clear'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** Reject request payloads larger than this (bytes of JSON string). */
export const MAX_IPC_PAYLOAD_BYTES = 64 * 1024 // 64 KiB

/** Hard cap on AX nodes returned over IPC (Phase 2 trimmer). */
export const MAX_AX_NODES = 400

/** Max characters kept for AX role / name strings. */
export const MAX_AX_STRING_CHARS = 120

/** Max base64 PCM chunk size for voice:pcmIn (≈ 24 KiB decoded). */
export const MAX_VOICE_PCM_BASE64_CHARS = 32 * 1024
