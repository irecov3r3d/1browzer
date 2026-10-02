import { describe, expect, it, vi } from 'vitest'
import {
  getPermissions,
  type TabCapability,
  type TabInfo
} from '../src/shared'
import {
  type MockableCdpSession,
  type MockableTab,
  type MockableTabManager
} from '../src/main/ipc/tabActions'
import {
  TOOL_RESPONSE_MAX_CHARS,
  capToolResponsePayload
} from '../src/main/voice/browserTools'
import { routeBrowserToolCalls } from '../src/main/voice/toolRouter'

function makeTab(
  id: string,
  capability: TabCapability,
  session: MockableCdpSession | null
): MockableTab {
  const perms = getPermissions(capability)
  const info: TabInfo = {
    id,
    capability,
    url: 'https://example.com',
    title: 'Example',
    canInput: perms.canInput,
    canCdpAttach: perms.canCdpAttach
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

describe('tool router capability denial', () => {
  it('Privacy cannot navigate or highlight via tools', async () => {
    const session = mockSession()
    const manager = makeManager([makeTab('p1', 'privacy', null)])

    const nav = await routeBrowserToolCalls(manager, 'p1', {
      functionCalls: [
        { id: '1', name: 'navigate', args: { url: 'https://example.org' } }
      ]
    })
    expect(nav.functionResponses[0]?.response.ok).toBe(false)
    expect(String(nav.functionResponses[0]?.response.code)).toMatch(
      /CAPABILITY|DENIED/
    )
    expect(session.navigate).not.toHaveBeenCalled()

    const hl = await routeBrowserToolCalls(manager, 'p1', {
      functionCalls: [{ id: '2', name: 'highlight_node', args: { nodeId: 9 } }]
    })
    expect(hl.functionResponses[0]?.response.ok).toBe(false)
    expect(session.highlightNode).not.toHaveBeenCalled()
  })

  it('Read-Only cannot navigate or highlight via tools', async () => {
    const session = mockSession()
    const manager = makeManager([makeTab('r1', 'readOnly', session)])

    const nav = await routeBrowserToolCalls(manager, 'r1', {
      functionCalls: [
        { id: '1', name: 'navigate', args: { url: 'https://example.org' } }
      ]
    })
    expect(nav.functionResponses[0]?.response.ok).toBe(false)
    expect(session.navigate).not.toHaveBeenCalled()

    const hl = await routeBrowserToolCalls(manager, 'r1', {
      functionCalls: [{ id: '2', name: 'highlight_node', args: { nodeId: 9 } }]
    })
    expect(hl.functionResponses[0]?.response.ok).toBe(false)
    expect(session.highlightNode).not.toHaveBeenCalled()
  })

  it('Active can navigate, highlight, and get_ax_tree', async () => {
    const session = mockSession()
    const manager = makeManager([makeTab('a1', 'active', session)])

    const tree = await routeBrowserToolCalls(manager, 'a1', {
      functionCalls: [{ name: 'get_ax_tree', args: { maxNodes: 50 } }]
    })
    expect(tree.functionResponses[0]?.response.ok).toBe(true)
    expect(session.getAxTree).toHaveBeenCalled()

    const hl = await routeBrowserToolCalls(manager, 'a1', {
      functionCalls: [{ name: 'highlight_node', args: { nodeId: 9 } }]
    })
    expect(hl.functionResponses[0]?.response.ok).toBe(true)
    expect(session.highlightNode).toHaveBeenCalledWith(9)

    const nav = await routeBrowserToolCalls(manager, 'a1', {
      functionCalls: [
        { name: 'navigate', args: { url: 'https://example.org' } }
      ]
    })
    expect(nav.functionResponses[0]?.response.ok).toBe(true)
    expect(session.navigate).toHaveBeenCalled()
  })

  it('list_tabs returns metadata only', async () => {
    const manager = makeManager([
      makeTab('a1', 'active', mockSession()),
      makeTab('p1', 'privacy', null)
    ])
    const listed = await routeBrowserToolCalls(manager, 'a1', {
      functionCalls: [{ name: 'list_tabs', args: {} }]
    })
    const response = listed.functionResponses[0]?.response as {
      ok: boolean
      tabs: { id: string; capability: string; url: string }[]
    }
    expect(response.ok).toBe(true)
    expect(response.tabs.length).toBe(2)
    expect(response.tabs[0]).toHaveProperty('capability')
    expect(response.tabs[0]).not.toHaveProperty('nodes')
  })
})

describe('tool response shaping', () => {
  it('caps oversized payloads', () => {
    const huge = {
      ok: true,
      nodes: Array.from({ length: 5000 }, (_, i) => ({
        axNodeId: i,
        role: 'div',
        name: 'x'.repeat(80)
      }))
    }
    const capped = capToolResponsePayload(huge) as {
      nodes?: unknown[]
      truncated?: boolean
      ok?: boolean
    }
    const size = JSON.stringify(capped).length
    expect(size).toBeLessThanOrEqual(TOOL_RESPONSE_MAX_CHARS)
    if (Array.isArray(capped.nodes)) {
      expect(capped.nodes.length).toBeLessThan(huge.nodes.length)
      expect(capped.truncated).toBe(true)
    } else {
      expect(capped.ok).toBe(false)
    }
  })
})
