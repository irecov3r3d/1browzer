import { z } from 'zod'
import { TAB_CAPABILITIES } from './capabilities'
import { MAX_VOICE_PCM_BASE64_CHARS } from './ipc'
import { VOICE_SESSION_STATES } from './voice'

/** Request for the Phase-1 ping demo channel. */
export const PingRequestSchema = z
  .object({
    nonce: z.string().min(1).max(128).optional()
  })
  .strict()

export type PingRequest = z.infer<typeof PingRequestSchema>

/** Successful ping response from Main. */
export const PingResponseSchema = z
  .object({
    ok: z.literal(true),
    ts: z.number().finite(),
    nonce: z.string().optional()
  })
  .strict()

export type PingResponse = z.infer<typeof PingResponseSchema>

/** Standard IPC error shape returned to the renderer on validation / gate failure. */
export const IpcErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
    code: z.enum([
      'VALIDATION',
      'OVERSIZE',
      'INTERNAL',
      'CDP',
      'CAPABILITY_DENIED',
      'NOT_FOUND',
      'NO_API_KEY',
      'VOICE'
    ])
  })
  .strict()

export type IpcError = z.infer<typeof IpcErrorSchema>

// --- Phase 2/3: CDP + tabs ---

/** http(s) URL only — no file://, javascript:, data:, etc. */
export const HttpUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .url()
  .refine(
    (u) => {
      try {
        const parsed = new URL(u)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'URL must use http or https' }
  )

export const TabIdSchema = z.string().min(1).max(64)

export const TabCapabilitySchema = z.enum(TAB_CAPABILITIES)

export type TabCapabilityName = z.infer<typeof TabCapabilitySchema>

/** Public tab summary for the renderer (no DOM/AX content). */
export const TabInfoSchema = z
  .object({
    id: TabIdSchema,
    capability: TabCapabilitySchema,
    url: z.string(),
    title: z.string(),
    canInput: z.boolean(),
    canCdpAttach: z.boolean()
  })
  .strict()

export type TabInfo = z.infer<typeof TabInfoSchema>

export const TabsListRequestSchema = z.object({}).strict()

export type TabsListRequest = z.infer<typeof TabsListRequestSchema>

export const TabsListResponseSchema = z
  .object({
    ok: z.literal(true),
    tabs: z.array(TabInfoSchema),
    activeTabId: TabIdSchema.nullable()
  })
  .strict()

export type TabsListResponse = z.infer<typeof TabsListResponseSchema>

export const TabsCreateRequestSchema = z
  .object({
    capability: TabCapabilitySchema,
    url: HttpUrlSchema.optional()
  })
  .strict()

export type TabsCreateRequest = z.infer<typeof TabsCreateRequestSchema>

export const TabsCreateResponseSchema = z
  .object({
    ok: z.literal(true),
    tab: TabInfoSchema
  })
  .strict()

export type TabsCreateResponse = z.infer<typeof TabsCreateResponseSchema>

export const TabsSetActiveRequestSchema = z
  .object({
    tabId: TabIdSchema
  })
  .strict()

export type TabsSetActiveRequest = z.infer<typeof TabsSetActiveRequestSchema>

export const TabsSetActiveResponseSchema = z
  .object({
    ok: z.literal(true),
    activeTabId: TabIdSchema
  })
  .strict()

export type TabsSetActiveResponse = z.infer<typeof TabsSetActiveResponseSchema>

export const TabsCloseRequestSchema = z
  .object({
    tabId: TabIdSchema
  })
  .strict()

export type TabsCloseRequest = z.infer<typeof TabsCloseRequestSchema>

export const TabsCloseResponseSchema = z
  .object({
    ok: z.literal(true),
    closedTabId: TabIdSchema
  })
  .strict()

export type TabsCloseResponse = z.infer<typeof TabsCloseResponseSchema>

/** Privacy lifecycle: open a Privacy tab with a URL (no CDP). */
export const TabsOpenPrivacyRequestSchema = z
  .object({
    url: HttpUrlSchema
  })
  .strict()

export type TabsOpenPrivacyRequest = z.infer<typeof TabsOpenPrivacyRequestSchema>

export const TabsOpenPrivacyResponseSchema = z
  .object({
    ok: z.literal(true),
    tab: TabInfoSchema
  })
  .strict()

export type TabsOpenPrivacyResponse = z.infer<
  typeof TabsOpenPrivacyResponseSchema
>

/** Trimmed AX node exposed to the renderer (no raw CDP blobs). */
export const AxNodeSchema = z
  .object({
    axNodeId: z.number().int(),
    backendDOMNodeId: z.number().int().optional(),
    role: z.string(),
    name: z.string(),
    ignored: z.boolean().optional()
  })
  .strict()

export type AxNode = z.infer<typeof AxNodeSchema>

export const CdpGetAxTreeRequestSchema = z
  .object({
    /** Target tab; omit to use the active tab. */
    tabId: TabIdSchema.optional(),
    /** Soft cap on nodes returned (Main also enforces a hard max). */
    maxNodes: z.number().int().min(1).max(2000).optional()
  })
  .strict()

export type CdpGetAxTreeRequest = z.infer<typeof CdpGetAxTreeRequestSchema>

export const CdpGetAxTreeResponseSchema = z
  .object({
    ok: z.literal(true),
    tabId: TabIdSchema,
    url: z.string(),
    nodes: z.array(AxNodeSchema),
    nodeCount: z.number().int().nonnegative(),
    truncated: z.boolean()
  })
  .strict()

export type CdpGetAxTreeResponse = z.infer<typeof CdpGetAxTreeResponseSchema>

/**
 * Highlight a DOM node. `nodeId` is the CDP backendDOMNodeId
 * (from AX tree `backendDOMNodeId`), not the AX nodeId.
 */
export const CdpHighlightNodeRequestSchema = z
  .object({
    tabId: TabIdSchema.optional(),
    nodeId: z.number().int().positive()
  })
  .strict()

export type CdpHighlightNodeRequest = z.infer<
  typeof CdpHighlightNodeRequestSchema
>

export const CdpHighlightNodeResponseSchema = z
  .object({
    ok: z.literal(true),
    tabId: TabIdSchema
  })
  .strict()

export type CdpHighlightNodeResponse = z.infer<
  typeof CdpHighlightNodeResponseSchema
>

export const CdpNavigateRequestSchema = z
  .object({
    tabId: TabIdSchema.optional(),
    url: HttpUrlSchema
  })
  .strict()

export type CdpNavigateRequest = z.infer<typeof CdpNavigateRequestSchema>

export const CdpNavigateResponseSchema = z
  .object({
    ok: z.literal(true),
    tabId: TabIdSchema,
    url: z.string()
  })
  .strict()

export type CdpNavigateResponse = z.infer<typeof CdpNavigateResponseSchema>

/** Default guest page when none configured. */
export const DEFAULT_GUEST_URL = 'https://example.com'


// --- Phase 4: Voice / Gemini Live ---

export const VoiceSessionStateSchema = z.enum(VOICE_SESSION_STATES)

export type VoiceSessionStateName = z.infer<typeof VoiceSessionStateSchema>

export const VoiceStartRequestSchema = z
  .object({
    /** Must resolve to an Active Worker tab; Privacy/Read-Only → CAPABILITY_DENIED. */
    tabId: TabIdSchema.optional()
  })
  .strict()

export type VoiceStartRequest = z.infer<typeof VoiceStartRequestSchema>

export const VoiceStartResponseSchema = z
  .object({
    ok: z.literal(true),
    state: VoiceSessionStateSchema,
    tabId: TabIdSchema,
    model: z.string(),
    resumed: z.boolean()
  })
  .strict()

export type VoiceStartResponse = z.infer<typeof VoiceStartResponseSchema>

export const VoiceStopRequestSchema = z.object({}).strict()

export type VoiceStopRequest = z.infer<typeof VoiceStopRequestSchema>

export const VoiceStopResponseSchema = z
  .object({
    ok: z.literal(true),
    state: VoiceSessionStateSchema
  })
  .strict()

export type VoiceStopResponse = z.infer<typeof VoiceStopResponseSchema>

export const VoiceStatusRequestSchema = z.object({}).strict()

export type VoiceStatusRequest = z.infer<typeof VoiceStatusRequestSchema>

export const VoiceStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    state: VoiceSessionStateSchema,
    tabId: TabIdSchema.nullable(),
    model: z.string().nullable(),
    hasApiKey: z.boolean(),
    sessionHandle: z.string().nullable(),
    lastError: z.string().nullable()
  })
  .strict()

export type VoiceStatusResponse = z.infer<typeof VoiceStatusResponseSchema>

/** Mic PCM Int16 LE frame, base64-encoded (typically 16 kHz). */
export const VoicePcmInRequestSchema = z
  .object({
    pcmBase64: z.string().min(1).max(MAX_VOICE_PCM_BASE64_CHARS),
    sampleRateHz: z.number().int().positive().optional()
  })
  .strict()

export type VoicePcmInRequest = z.infer<typeof VoicePcmInRequestSchema>

export const VoiceInterruptRequestSchema = z.object({}).strict()

export type VoiceInterruptRequest = z.infer<typeof VoiceInterruptRequestSchema>

export const VoiceInterruptResponseSchema = z
  .object({
    ok: z.literal(true),
    interrupted: z.boolean()
  })
  .strict()

export type VoiceInterruptResponse = z.infer<typeof VoiceInterruptResponseSchema>

/** Push events from Main → Renderer (preload subscription). */
export const VoiceEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('status'),
      state: VoiceSessionStateSchema,
      tabId: TabIdSchema.nullable(),
      detail: z.string().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('transcript'),
      role: z.enum(['user', 'model', 'system']),
      text: z.string().max(4000),
      stub: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('pcmOut'),
      pcmBase64: z.string().min(1).max(MAX_VOICE_PCM_BASE64_CHARS),
      sampleRateHz: z.number().int().positive()
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      error: z.string(),
      code: z.enum(['NO_API_KEY', 'VOICE', 'CAPABILITY_DENIED', 'INTERNAL'])
    })
    .strict(),
  z
    .object({
      type: z.literal('interrupted'),
      reason: z.string().optional()
    })
    .strict()
])

export type VoiceEvent = z.infer<typeof VoiceEventSchema>


// --- Phase 5: Session persistence ---

export const SessionIdSchema = z.string().min(1).max(64)

export const SessionSummarySchema = z
  .object({
    id: SessionIdSchema,
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
    turnCount: z.number().int().nonnegative(),
    preview: z.string()
  })
  .strict()

export type SessionSummaryDto = z.infer<typeof SessionSummarySchema>

export const SessionTurnSchema = z
  .object({
    id: z.string().min(1).max(64),
    role: z.enum(['user', 'model', 'system', 'tool']),
    text: z.string().max(4000),
    ts: z.number().finite(),
    stub: z.boolean().optional()
  })
  .strict()

export type SessionTurnDto = z.infer<typeof SessionTurnSchema>

export const SessionListRequestSchema = z.object({}).strict()
export type SessionListRequest = z.infer<typeof SessionListRequestSchema>

export const SessionListResponseSchema = z
  .object({
    ok: z.literal(true),
    backend: z.enum(['sqlite', 'json']),
    sessions: z.array(SessionSummarySchema)
  })
  .strict()
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>

export const SessionLoadRequestSchema = z
  .object({
    /** Omit to load the most recent session. */
    sessionId: SessionIdSchema.optional()
  })
  .strict()
export type SessionLoadRequest = z.infer<typeof SessionLoadRequestSchema>

export const SessionLoadResponseSchema = z
  .object({
    ok: z.literal(true),
    backend: z.enum(['sqlite', 'json']),
    session: z
      .object({
        id: SessionIdSchema,
        createdAt: z.number().finite(),
        updatedAt: z.number().finite(),
        turns: z.array(SessionTurnSchema)
      })
      .strict()
      .nullable()
  })
  .strict()
export type SessionLoadResponse = z.infer<typeof SessionLoadResponseSchema>

export const SessionClearRequestSchema = z
  .object({
    /** When set, clear only that session; otherwise clear all. */
    sessionId: SessionIdSchema.optional(),
    /** Must be true to clear all sessions (destructive). */
    clearAll: z.boolean().optional()
  })
  .strict()
export type SessionClearRequest = z.infer<typeof SessionClearRequestSchema>

export const SessionClearResponseSchema = z
  .object({
    ok: z.literal(true),
    cleared: z.number().int().nonnegative()
  })
  .strict()
export type SessionClearResponse = z.infer<typeof SessionClearResponseSchema>
