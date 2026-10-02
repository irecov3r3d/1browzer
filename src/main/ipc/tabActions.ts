/**
 * Capability-gated tab / CDP actions used by IPC handlers.
 * Accepts a narrow manager interface so unit tests can mock sessions headlessly.
 */
import {
  type CapabilityAction,
  type CdpGetAxTreeResponse,
  type CdpHighlightNodeResponse,
  type CdpNavigateResponse,
  type IpcError,
  type TabCapability,
  type TabInfo
} from '../../shared'
import { denyIfNotAllowed } from '../capabilities/gate'

/** Minimal CDP session surface for gating tests. */
export type MockableCdpSession = {
  getAxTree: (maxNodes?: number) => Promise<{
    url: string
    nodes: CdpGetAxTreeResponse['nodes']
    nodeCount: number
    truncated: boolean
  }>
  highlightNode: (nodeId: number) => Promise<void>
  navigate: (url: string) => Promise<string>
}

export type MockableTab = {
  id: string
  capability: TabCapability
  getSession: () => MockableCdpSession | null
  toInfo: () => TabInfo
}

export type MockableTabManager = {
  listTabs: () => { tabs: TabInfo[]; activeTabId: string | null }
  resolveTab: (tabId?: string) => MockableTab | undefined
  createTab: (opts: {
    capability: TabCapability
    url?: string
  }) => TabInfo
  openPrivacyTab: (url: string) => TabInfo
  setActiveTab: (tabId: string) => string
  closeTab: (tabId: string) => string
}

function notFound(tabId?: string): IpcError {
  return {
    ok: false,
    error: tabId ? `Tab not found: ${tabId}` : 'No active tab',
    code: 'NOT_FOUND'
  }
}

function toCdpError(err: unknown): IpcError {
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    code: 'CDP'
  }
}

function gate(
  tab: MockableTab,
  action: CapabilityAction
): IpcError | null {
  return denyIfNotAllowed(tab.capability, action)
}

export function actionListTabs(
  manager: MockableTabManager
): { ok: true; tabs: TabInfo[]; activeTabId: string | null } {
  const { tabs, activeTabId } = manager.listTabs()
  return { ok: true, tabs, activeTabId }
}

export function actionCreateTab(
  manager: MockableTabManager,
  capability: TabCapability,
  url?: string
): { ok: true; tab: TabInfo } | IpcError {
  try {
    const tab = manager.createTab({ capability, url })
    return { ok: true, tab }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'INTERNAL'
    }
  }
}

export function actionOpenPrivacyTab(
  manager: MockableTabManager,
  url: string
): { ok: true; tab: TabInfo } | IpcError {
  try {
    const tab = manager.openPrivacyTab(url)
    return { ok: true, tab }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'INTERNAL'
    }
  }
}

export function actionSetActiveTab(
  manager: MockableTabManager,
  tabId: string
): { ok: true; activeTabId: string } | IpcError {
  try {
    const activeTabId = manager.setActiveTab(tabId)
    return { ok: true, activeTabId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'NOT_FOUND'
    }
  }
}

export function actionCloseTab(
  manager: MockableTabManager,
  tabId: string
): { ok: true; closedTabId: string } | IpcError {
  try {
    const closedTabId = manager.closeTab(tabId)
    return { ok: true, closedTabId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: 'NOT_FOUND'
    }
  }
}

export async function actionGetAxTree(
  manager: MockableTabManager,
  opts: { tabId?: string; maxNodes?: number }
): Promise<CdpGetAxTreeResponse | IpcError> {
  const tab = manager.resolveTab(opts.tabId)
  if (!tab) return notFound(opts.tabId)

  const denied = gate(tab, 'getAxTree')
  if (denied) return denied

  // Privacy has no session; Active/ReadOnly should.
  const session = tab.getSession()
  if (!session) {
    return {
      ok: false,
      error: `No CDP session for tab ${tab.id} (${tab.capability})`,
      code: 'CAPABILITY_DENIED'
    }
  }

  try {
    const tree = await session.getAxTree(opts.maxNodes)
    return {
      ok: true,
      tabId: tab.id,
      url: tree.url,
      nodes: tree.nodes,
      nodeCount: tree.nodeCount,
      truncated: tree.truncated
    }
  } catch (err) {
    return toCdpError(err)
  }
}

export async function actionHighlightNode(
  manager: MockableTabManager,
  opts: { tabId?: string; nodeId: number }
): Promise<CdpHighlightNodeResponse | IpcError> {
  const tab = manager.resolveTab(opts.tabId)
  if (!tab) return notFound(opts.tabId)

  const denied = gate(tab, 'highlightNode')
  if (denied) return denied

  const session = tab.getSession()
  if (!session) {
    return {
      ok: false,
      error: `No CDP session for tab ${tab.id} (${tab.capability})`,
      code: 'CAPABILITY_DENIED'
    }
  }

  try {
    await session.highlightNode(opts.nodeId)
    return { ok: true, tabId: tab.id }
  } catch (err) {
    return toCdpError(err)
  }
}

export async function actionNavigate(
  manager: MockableTabManager,
  opts: { tabId?: string; url: string }
): Promise<CdpNavigateResponse | IpcError> {
  const tab = manager.resolveTab(opts.tabId)
  if (!tab) return notFound(opts.tabId)

  const denied = gate(tab, 'navigate')
  if (denied) return denied

  const session = tab.getSession()
  if (!session) {
    return {
      ok: false,
      error: `No CDP session for tab ${tab.id} (${tab.capability})`,
      code: 'CAPABILITY_DENIED'
    }
  }

  try {
    const url = await session.navigate(opts.url)
    return { ok: true, tabId: tab.id, url }
  } catch (err) {
    return toCdpError(err)
  }
}
