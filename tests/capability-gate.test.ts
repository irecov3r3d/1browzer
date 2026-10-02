import { describe, expect, it, vi } from 'vitest'
import {
  CAPABILITY_PERMISSIONS,
  isActionAllowed,
  type TabCapability,
  type TabInfo
} from '../src/shared'
import { denyIfNotAllowed } from '../src/main/capabilities/gate'
import {
  actionGetAxTree,
  actionHighlightNode,
  actionNavigate,
  type MockableCdpSession,
  type MockableTab,
  type MockableTabManager
} from '../src/main/ipc/tabActions'

function makeTab(
  id: string,
  capability: TabCapability,
  session: MockableCdpSession | null
): MockableTab {
  const info: TabInfo = {
    id,
    capability,
    url: 'https://example.com',
    title: 'Example',
    canInput: CAPABILITY_PERMISSIONS[capability].canInput,
    canCdpAttach: CAPABILITY_PERMISSIONS[capability].canCdpAttach
  }
  return {
    id,
    capability,
    getSession: () => session,
    toInfo: () => info
  }
}

function makeManager(tabs: MockableTab[]): MockableTabManager {
  const map = new Map(tabs.map((t) => [t.id, t]))
  let activeTabId: string | null = tabs[0]?.id ?? null
  return {
    listTabs: () => ({
      tabs: tabs.map((t) => t.toInfo()),
      activeTabId
    }),
    resolveTab: (tabId?: string) => {
      if (tabId) return map.get(tabId)
      return activeTabId ? map.get(activeTabId) : undefined
    },
    createTab: ({ capability, url }) => {
      const id = `new-${capability}`
      const tab = makeTab(id, capability, null)
      map.set(id, tab)
      return { ...tab.toInfo(), url: url ?? tab.toInfo().url }
    },
    openPrivacyTab: (url) => {
      const id = 'privacy-new'
      const tab = makeTab(id, 'privacy', null)
      map.set(id, tab)
      return { ...tab.toInfo(), url }
    },
    setActiveTab: (tabId) => {
      if (!map.has(tabId)) throw new Error(`Tab not found: ${tabId}`)
      activeTabId = tabId
      return tabId
    },
    closeTab: (tabId) => {
      if (!map.has(tabId)) throw new Error(`Tab not found: ${tabId}`)
      map.delete(tabId)
      if (activeTabId === tabId) activeTabId = null
      return tabId
    }
  }
}

function mockSession(): MockableCdpSession {
  return {
    getAxTree: vi.fn(async () => ({
      url: 'https://example.com',
      nodes: [
        {
          axNodeId: 1,
          role: 'button',
          name: 'Go',
          backendDOMNodeId: 9
        }
      ],
      nodeCount: 1,
      truncated: false
    })),
    highlightNode: vi.fn(async () => undefined),
    navigate: vi.fn(async (url: string) => url)
  }
}

describe('capability permission matrix', () => {
  it('Active allows all CDP + input', () => {
    expect(isActionAllowed('active', 'cdpAttach')).toBe(true)
    expect(isActionAllowed('active', 'getAxTree')).toBe(true)
    expect(isActionAllowed('active', 'highlightNode')).toBe(true)
    expect(isActionAllowed('active', 'navigate')).toBe(true)
    expect(isActionAllowed('active', 'input')).toBe(true)
    expect(isActionAllowed('active', 'voice')).toBe(true)
    expect(CAPABILITY_PERMISSIONS.active.canInput).toBe(true)
    expect(CAPABILITY_PERMISSIONS.active.canVoice).toBe(true)
  })

  it('Read-Only allows AX/attach only', () => {
    expect(isActionAllowed('readOnly', 'cdpAttach')).toBe(true)
    expect(isActionAllowed('readOnly', 'getAxTree')).toBe(true)
    expect(isActionAllowed('readOnly', 'highlightNode')).toBe(false)
    expect(isActionAllowed('readOnly', 'navigate')).toBe(false)
    expect(isActionAllowed('readOnly', 'input')).toBe(false)
    expect(isActionAllowed('readOnly', 'voice')).toBe(false)
  })

  it('Privacy denies all CDP actions', () => {
    expect(isActionAllowed('privacy', 'cdpAttach')).toBe(false)
    expect(isActionAllowed('privacy', 'getAxTree')).toBe(false)
    expect(isActionAllowed('privacy', 'highlightNode')).toBe(false)
    expect(isActionAllowed('privacy', 'navigate')).toBe(false)
    expect(isActionAllowed('privacy', 'input')).toBe(false)
    expect(isActionAllowed('privacy', 'voice')).toBe(false)
  })

  it('denyIfNotAllowed returns CAPABILITY_DENIED', () => {
    const err = denyIfNotAllowed('readOnly', 'highlightNode')
    expect(err).not.toBeNull()
    expect(err?.code).toBe('CAPABILITY_DENIED')
    expect(denyIfNotAllowed('active', 'highlightNode')).toBeNull()
  })
})

describe('IPC action gating with mocked sessions', () => {
  it('Active can getAxTree, highlight, and navigate', async () => {
    const session = mockSession()
    const manager = makeManager([makeTab('a1', 'active', session)])

    const tree = await actionGetAxTree(manager, { tabId: 'a1' })
    expect(tree.ok).toBe(true)
    if (tree.ok) expect(tree.tabId).toBe('a1')

    const hl = await actionHighlightNode(manager, { tabId: 'a1', nodeId: 9 })
    expect(hl.ok).toBe(true)
    expect(session.highlightNode).toHaveBeenCalledWith(9)

    const nav = await actionNavigate(manager, {
      tabId: 'a1',
      url: 'https://example.org'
    })
    expect(nav.ok).toBe(true)
    expect(session.navigate).toHaveBeenCalled()
  })

  it('Read-Only can getAxTree but not highlight or navigate', async () => {
    const session = mockSession()
    const manager = makeManager([makeTab('r1', 'readOnly', session)])

    const tree = await actionGetAxTree(manager, { tabId: 'r1' })
    expect(tree.ok).toBe(true)

    const hl = await actionHighlightNode(manager, { tabId: 'r1', nodeId: 9 })
    expect(hl.ok).toBe(false)
    if (!hl.ok) expect(hl.code).toBe('CAPABILITY_DENIED')
    expect(session.highlightNode).not.toHaveBeenCalled()

    const nav = await actionNavigate(manager, {
      tabId: 'r1',
      url: 'https://example.org'
    })
    expect(nav.ok).toBe(false)
    if (!nav.ok) expect(nav.code).toBe('CAPABILITY_DENIED')
    expect(session.navigate).not.toHaveBeenCalled()
  })

  it('Privacy cannot getAxTree (CAPABILITY_DENIED)', async () => {
    const manager = makeManager([makeTab('p1', 'privacy', null)])

    const tree = await actionGetAxTree(manager, { tabId: 'p1' })
    expect(tree.ok).toBe(false)
    if (!tree.ok) {
      expect(tree.code).toBe('CAPABILITY_DENIED')
      expect(tree.error).toMatch(/privacy/i)
    }
  })

  it('Privacy cannot highlight or navigate', async () => {
    const manager = makeManager([makeTab('p1', 'privacy', null)])

    const hl = await actionHighlightNode(manager, { tabId: 'p1', nodeId: 1 })
    expect(hl.ok).toBe(false)
    if (!hl.ok) expect(hl.code).toBe('CAPABILITY_DENIED')

    const nav = await actionNavigate(manager, {
      tabId: 'p1',
      url: 'https://example.org'
    })
    expect(nav.ok).toBe(false)
    if (!nav.ok) expect(nav.code).toBe('CAPABILITY_DENIED')
  })

  it('missing tab returns NOT_FOUND', async () => {
    const manager = makeManager([])
    const tree = await actionGetAxTree(manager, { tabId: 'missing' })
    expect(tree.ok).toBe(false)
    if (!tree.ok) expect(tree.code).toBe('NOT_FOUND')
  })
})
