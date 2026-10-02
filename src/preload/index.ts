import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type OneBrowzerApi,
  type PingRequest,
  type PingResponse,
  type IpcError,
  type CdpGetAxTreeRequest,
  type CdpGetAxTreeResponse,
  type CdpHighlightNodeRequest,
  type CdpHighlightNodeResponse,
  type CdpNavigateRequest,
  type CdpNavigateResponse,
  type TabsListRequest,
  type TabsListResponse,
  type TabsCreateRequest,
  type TabsCreateResponse,
  type TabsSetActiveRequest,
  type TabsSetActiveResponse,
  type TabsCloseRequest,
  type TabsCloseResponse,
  type TabsOpenPrivacyRequest,
  type TabsOpenPrivacyResponse,
  type VoiceStartRequest,
  type VoiceStartResponse,
  type VoiceStopRequest,
  type VoiceStopResponse,
  type VoiceStatusRequest,
  type VoiceStatusResponse,
  type VoicePcmInRequest,
  type VoiceInterruptRequest,
  type VoiceInterruptResponse,
  type VoiceEvent,
  type SessionListRequest,
  type SessionListResponse,
  type SessionLoadRequest,
  type SessionLoadResponse,
  type SessionClearRequest,
  type SessionClearResponse
} from '../shared'

const api: OneBrowzerApi = {
  ping: (request: PingRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.PING, request) as Promise<
      PingResponse | IpcError
    >,
  listTabs: (request: TabsListRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.TABS_LIST, request) as Promise<
      TabsListResponse | IpcError
    >,
  createTab: (request: TabsCreateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.TABS_CREATE, request) as Promise<
      TabsCreateResponse | IpcError
    >,
  setActiveTab: (request: TabsSetActiveRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.TABS_SET_ACTIVE, request) as Promise<
      TabsSetActiveResponse | IpcError
    >,
  closeTab: (request: TabsCloseRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.TABS_CLOSE, request) as Promise<
      TabsCloseResponse | IpcError
    >,
  openPrivacyTab: (request: TabsOpenPrivacyRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.TABS_OPEN_PRIVACY, request) as Promise<
      TabsOpenPrivacyResponse | IpcError
    >,
  getAxTree: (request: CdpGetAxTreeRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.CDP_GET_AX_TREE, request) as Promise<
      CdpGetAxTreeResponse | IpcError
    >,
  highlightNode: (request: CdpHighlightNodeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.CDP_HIGHLIGHT_NODE, request) as Promise<
      CdpHighlightNodeResponse | IpcError
    >,
  navigate: (request: CdpNavigateRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.CDP_NAVIGATE, request) as Promise<
      CdpNavigateResponse | IpcError
    >,
  voiceStart: (request: VoiceStartRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_START, request) as Promise<
      VoiceStartResponse | IpcError
    >,
  voiceStop: (request: VoiceStopRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_STOP, request) as Promise<
      VoiceStopResponse | IpcError
    >,
  voiceStatus: (request: VoiceStatusRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_STATUS, request) as Promise<
      VoiceStatusResponse | IpcError
    >,
  voicePcmIn: (request: VoicePcmInRequest) => {
    ipcRenderer.send(IPC_CHANNELS.VOICE_PCM_IN, request)
  },
  voiceInterrupt: (request: VoiceInterruptRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_INTERRUPT, request) as Promise<
      VoiceInterruptResponse | IpcError
    >,
  onVoiceEvent: (handler: (event: VoiceEvent) => void) => {
    const listener = (_event: IpcRendererEvent, data: VoiceEvent): void => {
      handler(data)
    }
    ipcRenderer.on(IPC_CHANNELS.VOICE_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.VOICE_EVENT, listener)
    }
  },
  sessionList: (request: SessionListRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST, request) as Promise<
      SessionListResponse | IpcError
    >,
  sessionLoad: (request: SessionLoadRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD, request) as Promise<
      SessionLoadResponse | IpcError
    >,
  sessionClear: (request: SessionClearRequest = {}) =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_CLEAR, request) as Promise<
      SessionClearResponse | IpcError
    >
}

contextBridge.exposeInMainWorld('onebrowzer', api)
