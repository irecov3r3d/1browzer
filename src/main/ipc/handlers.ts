import { ipcMain, IpcMainInvokeEvent } from 'electron'
import {
  IPC_CHANNELS,
  PingRequestSchema,
  CdpGetAxTreeRequestSchema,
  CdpHighlightNodeRequestSchema,
  CdpNavigateRequestSchema,
  TabsListRequestSchema,
  TabsCreateRequestSchema,
  TabsSetActiveRequestSchema,
  TabsCloseRequestSchema,
  TabsOpenPrivacyRequestSchema,
  VoiceStartRequestSchema,
  VoiceStopRequestSchema,
  VoiceStatusRequestSchema,
  VoicePcmInRequestSchema,
  VoiceInterruptRequestSchema,
  SessionListRequestSchema,
  SessionLoadRequestSchema,
  SessionClearRequestSchema,
  type PingResponse,
  type IpcError
} from '../../shared'
import { validateIpcPayload } from './validate'
import type { TabCapabilityManager } from '../guest/TabCapabilityManager'
import type { VoiceSession } from '../voice/VoiceSession'
import {
  actionCloseTab,
  actionCreateTab,
  actionGetAxTree,
  actionHighlightNode,
  actionListTabs,
  actionNavigate,
  actionOpenPrivacyTab,
  actionSetActiveTab
} from './tabActions'
import {
  actionVoiceInterrupt,
  actionVoiceStart,
  actionVoiceStatus,
  actionVoiceStop
} from '../voice/voiceActions'
import type { SessionStore } from '../session'
import {
  actionSessionClear,
  actionSessionList,
  actionSessionLoad
} from '../session/sessionActions'

function handlePing(
  _event: IpcMainInvokeEvent,
  payload: unknown
): PingResponse | IpcError {
  const validated = validateIpcPayload(PingRequestSchema, payload ?? {})
  if (!validated.ok) {
    return validated
  }

  return {
    ok: true,
    ts: Date.now(),
    ...(validated.data.nonce !== undefined
      ? { nonce: validated.data.nonce }
      : {})
  }
}

/**
 * Register IPC handlers bound to the Tab Capability Manager + VoiceSession.
 * All cdp:* / voice:* channels are gated by the target tab's capability class.
 */
export function registerIpcHandlers(
  manager: TabCapabilityManager,
  voiceSession: VoiceSession,
  sessionStore: SessionStore
): void {
  ipcMain.handle(IPC_CHANNELS.PING, handlePing)

  ipcMain.handle(
    IPC_CHANNELS.TABS_LIST,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        TabsListRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionListTabs(manager)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TABS_CREATE,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(TabsCreateRequestSchema, payload)
      if (!validated.ok) return validated
      return actionCreateTab(
        manager,
        validated.data.capability,
        validated.data.url
      )
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TABS_SET_ACTIVE,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        TabsSetActiveRequestSchema,
        payload
      )
      if (!validated.ok) return validated
      return actionSetActiveTab(manager, validated.data.tabId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TABS_CLOSE,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(TabsCloseRequestSchema, payload)
      if (!validated.ok) return validated
      return actionCloseTab(manager, validated.data.tabId)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.TABS_OPEN_PRIVACY,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        TabsOpenPrivacyRequestSchema,
        payload
      )
      if (!validated.ok) return validated
      return actionOpenPrivacyTab(manager, validated.data.url)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CDP_GET_AX_TREE,
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        CdpGetAxTreeRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionGetAxTree(manager, {
        tabId: validated.data.tabId,
        maxNodes: validated.data.maxNodes
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CDP_HIGHLIGHT_NODE,
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        CdpHighlightNodeRequestSchema,
        payload
      )
      if (!validated.ok) return validated
      return actionHighlightNode(manager, {
        tabId: validated.data.tabId,
        nodeId: validated.data.nodeId
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.CDP_NAVIGATE,
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(CdpNavigateRequestSchema, payload)
      if (!validated.ok) return validated
      return actionNavigate(manager, {
        tabId: validated.data.tabId,
        url: validated.data.url
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.VOICE_START,
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        VoiceStartRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionVoiceStart(manager, voiceSession, {
        tabId: validated.data.tabId
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.VOICE_STOP,
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        VoiceStopRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionVoiceStop(voiceSession)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.VOICE_STATUS,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        VoiceStatusRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionVoiceStatus(voiceSession)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.VOICE_INTERRUPT,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        VoiceInterruptRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionVoiceInterrupt(voiceSession)
    }
  )

  // Fire-and-forget mic frames (renderer → main). Validated but no reply.
  ipcMain.on(IPC_CHANNELS.VOICE_PCM_IN, (_event, payload: unknown) => {
    const validated = validateIpcPayload(VoicePcmInRequestSchema, payload)
    if (!validated.ok) return
    voiceSession.sendPcmIn(
      validated.data.pcmBase64,
      validated.data.sampleRateHz
    )
  })


  ipcMain.handle(
    IPC_CHANNELS.SESSION_LIST,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        SessionListRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionSessionList(sessionStore)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_LOAD,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        SessionLoadRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionSessionLoad(sessionStore, {
        sessionId: validated.data.sessionId
      })
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.SESSION_CLEAR,
    (_event: IpcMainInvokeEvent, payload: unknown) => {
      const validated = validateIpcPayload(
        SessionClearRequestSchema,
        payload ?? {}
      )
      if (!validated.ok) return validated
      return actionSessionClear(sessionStore, {
        sessionId: validated.data.sessionId,
        clearAll: validated.data.clearAll
      })
    }
  )
}
