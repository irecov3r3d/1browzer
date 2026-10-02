import type {
  PingRequest,
  PingResponse,
  IpcError,
  CdpGetAxTreeRequest,
  CdpGetAxTreeResponse,
  CdpHighlightNodeRequest,
  CdpHighlightNodeResponse,
  CdpNavigateRequest,
  CdpNavigateResponse,
  TabsListRequest,
  TabsListResponse,
  TabsCreateRequest,
  TabsCreateResponse,
  TabsSetActiveRequest,
  TabsSetActiveResponse,
  TabsCloseRequest,
  TabsCloseResponse,
  TabsOpenPrivacyRequest,
  TabsOpenPrivacyResponse,
  VoiceStartRequest,
  VoiceStartResponse,
  VoiceStopRequest,
  VoiceStopResponse,
  VoiceStatusRequest,
  VoiceStatusResponse,
  VoicePcmInRequest,
  VoiceInterruptRequest,
  VoiceInterruptResponse,
  VoiceEvent,
  SessionListRequest,
  SessionListResponse,
  SessionLoadRequest,
  SessionLoadResponse,
  SessionClearRequest,
  SessionClearResponse
} from './schemas'

/**
 * Narrow API surface exposed to the renderer via contextBridge.
 * Declared in shared so renderer types do not import Electron preload.
 */
export type OneBrowzerApi = {
  ping: (request?: PingRequest) => Promise<PingResponse | IpcError>
  listTabs: (
    request?: TabsListRequest
  ) => Promise<TabsListResponse | IpcError>
  createTab: (
    request: TabsCreateRequest
  ) => Promise<TabsCreateResponse | IpcError>
  setActiveTab: (
    request: TabsSetActiveRequest
  ) => Promise<TabsSetActiveResponse | IpcError>
  closeTab: (
    request: TabsCloseRequest
  ) => Promise<TabsCloseResponse | IpcError>
  openPrivacyTab: (
    request: TabsOpenPrivacyRequest
  ) => Promise<TabsOpenPrivacyResponse | IpcError>
  getAxTree: (
    request?: CdpGetAxTreeRequest
  ) => Promise<CdpGetAxTreeResponse | IpcError>
  highlightNode: (
    request: CdpHighlightNodeRequest
  ) => Promise<CdpHighlightNodeResponse | IpcError>
  navigate: (
    request: CdpNavigateRequest
  ) => Promise<CdpNavigateResponse | IpcError>
  voiceStart: (
    request?: VoiceStartRequest
  ) => Promise<VoiceStartResponse | IpcError>
  voiceStop: (
    request?: VoiceStopRequest
  ) => Promise<VoiceStopResponse | IpcError>
  voiceStatus: (
    request?: VoiceStatusRequest
  ) => Promise<VoiceStatusResponse | IpcError>
  /** Fire-and-forget mic PCM frame to Main (no response). */
  voicePcmIn: (request: VoicePcmInRequest) => void
  voiceInterrupt: (
    request?: VoiceInterruptRequest
  ) => Promise<VoiceInterruptResponse | IpcError>
  /** Subscribe to Main → Renderer voice push events. Returns unsubscribe. */
  onVoiceEvent: (handler: (event: VoiceEvent) => void) => () => void
  sessionList: (
    request?: SessionListRequest
  ) => Promise<SessionListResponse | IpcError>
  sessionLoad: (
    request?: SessionLoadRequest
  ) => Promise<SessionLoadResponse | IpcError>
  sessionClear: (
    request?: SessionClearRequest
  ) => Promise<SessionClearResponse | IpcError>
}
