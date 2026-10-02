/**
 * Capability-gated voice IPC actions (testable without Electron).
 */

import type {
  IpcError,
  TabCapability,
  TabInfo,
  VoiceInterruptResponse,
  VoiceStartResponse,
  VoiceStatusResponse,
  VoiceStopResponse
} from '../../shared'
import { denyIfNotAllowed } from '../capabilities/gate'
import type { VoiceSession } from './VoiceSession'

export type VoiceTab = {
  id: string
  capability: TabCapability
  toInfo: () => TabInfo
}

export type VoiceTabResolver = {
  resolveTab: (tabId?: string) => VoiceTab | undefined
}

export type VoiceSessionLike = Pick<
  VoiceSession,
  'start' | 'stop' | 'getSnapshot' | 'hasApiKey' | 'interrupt' | 'sendPcmIn'
>

function notFound(tabId?: string): IpcError {
  return {
    ok: false,
    error: tabId ? `Tab not found: ${tabId}` : 'No active tab',
    code: 'NOT_FOUND'
  }
}

function noApiKey(): IpcError {
  return {
    ok: false,
    error:
      'GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.',
    code: 'NO_API_KEY'
  }
}

/**
 * Start voice on the target tab.
 * - Missing API key → NO_API_KEY
 * - Privacy / Read-Only (or any !canVoice) → CAPABILITY_DENIED
 * - Active → session.start()
 */
export async function actionVoiceStart(
  manager: VoiceTabResolver,
  session: VoiceSessionLike,
  opts: { tabId?: string } = {}
): Promise<VoiceStartResponse | IpcError> {
  if (!session.hasApiKey()) {
    return noApiKey()
  }

  const tab = manager.resolveTab(opts.tabId)
  if (!tab) return notFound(opts.tabId)

  const denied = denyIfNotAllowed(tab.capability, 'voice')
  if (denied) return denied

  try {
    const { resumed, model } = await session.start({ tabId: tab.id })
    const snap = session.getSnapshot()
    return {
      ok: true,
      state: snap.state,
      tabId: tab.id,
      model,
      resumed
    }
  } catch (err) {
    const code =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'NO_API_KEY'
        ? 'NO_API_KEY'
        : 'VOICE'
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code
    }
  }
}

export async function actionVoiceStop(
  session: VoiceSessionLike
): Promise<VoiceStopResponse | IpcError> {
  try {
    await session.stop()
    return { ok: true, state: session.getSnapshot().state }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'VOICE'
    }
  }
}

export function actionVoiceStatus(
  session: VoiceSessionLike
): VoiceStatusResponse {
  const snap = session.getSnapshot()
  return {
    ok: true,
    state: snap.state,
    tabId: snap.tabId,
    model: snap.model,
    hasApiKey: session.hasApiKey(),
    sessionHandle: snap.sessionHandle,
    lastError: snap.lastError
  }
}

export function actionVoiceInterrupt(
  session: VoiceSessionLike
): VoiceInterruptResponse {
  const interrupted = session.interrupt('vad')
  return { ok: true, interrupted }
}
