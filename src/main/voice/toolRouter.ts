/**
 * Route Gemini Live tool calls through capability-gated tabActions.
 * Mutating tools and get_ax_tree always target the Active voice tab —
 * never Privacy / Read-Only, even if the model invents another tab id.
 */

import {
  actionGetAxTree,
  actionHighlightNode,
  actionListTabs,
  actionNavigate,
  type MockableTabManager
} from '../ipc/tabActions'
import {
  TOOL_AX_MAX_NODES,
  capToolResponsePayload,
  type BrowserToolName
} from './browserTools'

export type ToolCallFunction = {
  id?: string
  name?: string
  args?: Record<string, unknown>
}

export type ToolCallPayload = {
  functionCalls?: ToolCallFunction[]
}

export type ToolFunctionResponse = {
  id?: string
  name: string
  response: Record<string, unknown>
}

export type ToolRouterResult = {
  functionResponses: ToolFunctionResponse[]
  summaries: string[]
}

function asRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  return {}
}

function denyActiveOnly(tool: string, capability: string): Record<string, unknown> {
  return {
    ok: false,
    error: `Tool '${tool}' requires Active Worker; tab capability is '${capability}'`,
    code: 'CAPABILITY_DENIED'
  }
}

function parseMaxNodes(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const n = Math.floor(raw)
  if (n < 1) return undefined
  return Math.min(n, TOOL_AX_MAX_NODES)
}

function parseNodeId(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  const n = Math.floor(raw)
  return n > 0 ? n : null
}

function parseHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  if (!url || url.length > 2048) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * Execute one or more functionCalls against the bound Active tab.
 * Capability gate still runs — Privacy/Read-Only cannot navigate/highlight.
 */
export async function routeBrowserToolCalls(
  manager: MockableTabManager,
  activeTabId: string,
  payload: unknown
): Promise<ToolRouterResult> {
  const calls = extractFunctionCalls(payload)
  const functionResponses: ToolFunctionResponse[] = []
  const summaries: string[] = []

  for (const call of calls) {
    const name = (call.name ?? '').trim() as BrowserToolName | ''
    const args = asRecord(call.args)
    const result = await executeOne(manager, activeTabId, name, args)
    const capped = capToolResponsePayload(result) as Record<string, unknown>
    functionResponses.push({
      ...(call.id ? { id: call.id } : {}),
      name: name || 'unknown',
      response: capped
    })
    const ok = capped.ok === true
    summaries.push(
      ok ? `${name || 'unknown'}: ok` : `${name || 'unknown'}: ${String(capped.code ?? 'error')}`
    )
  }

  if (functionResponses.length === 0) {
    functionResponses.push({
      name: 'unknown',
      response: {
        ok: false,
        error: 'No functionCalls in toolCall payload',
        code: 'VALIDATION'
      }
    })
    summaries.push('unknown: VALIDATION')
  }

  return { functionResponses, summaries }
}

export function extractFunctionCalls(payload: unknown): ToolCallFunction[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as ToolCallPayload & { functionCall?: ToolCallFunction }
  if (Array.isArray(p.functionCalls) && p.functionCalls.length > 0) {
    return p.functionCalls
  }
  if (p.functionCall && typeof p.functionCall === 'object') {
    return [p.functionCall]
  }
  // Some SDK shapes nest under functionCalls on the message itself.
  if (Array.isArray((payload as { functionCalls?: unknown }).functionCalls)) {
    return (payload as { functionCalls: ToolCallFunction[] }).functionCalls
  }
  return []
}

async function executeOne(
  manager: MockableTabManager,
  activeTabId: string,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tab = manager.resolveTab(activeTabId)
  if (!tab) {
    return {
      ok: false,
      error: `Active tab not found: ${activeTabId}`,
      code: 'NOT_FOUND'
    }
  }

  switch (name) {
    case 'list_tabs': {
      const listed = actionListTabs(manager)
      // Metadata only — never AX/DOM. Strip titles if desired; url is enough.
      return {
        ok: true,
        activeTabId: listed.activeTabId,
        tabs: listed.tabs.map((t) => ({
          id: t.id,
          capability: t.capability,
          url: t.url
        }))
      }
    }
    case 'get_ax_tree': {
      if (tab.capability !== 'active') {
        return denyActiveOnly(name, tab.capability)
      }
      const maxNodes = parseMaxNodes(args.maxNodes) ?? TOOL_AX_MAX_NODES
      const result = await actionGetAxTree(manager, {
        tabId: activeTabId,
        maxNodes
      })
      return result as unknown as Record<string, unknown>
    }
    case 'highlight_node': {
      if (tab.capability !== 'active') {
        return denyActiveOnly(name, tab.capability)
      }
      const nodeId = parseNodeId(args.nodeId)
      if (nodeId == null) {
        return {
          ok: false,
          error: 'highlight_node requires positive numeric nodeId',
          code: 'VALIDATION'
        }
      }
      const result = await actionHighlightNode(manager, {
        tabId: activeTabId,
        nodeId
      })
      return result as unknown as Record<string, unknown>
    }
    case 'navigate': {
      if (tab.capability !== 'active') {
        return denyActiveOnly(name, tab.capability)
      }
      const url = parseHttpUrl(args.url)
      if (!url) {
        return {
          ok: false,
          error: 'navigate requires an http(s) url',
          code: 'VALIDATION'
        }
      }
      const result = await actionNavigate(manager, {
        tabId: activeTabId,
        url
      })
      return result as unknown as Record<string, unknown>
    }
    default:
      return {
        ok: false,
        error: `Unknown tool: ${name || '(empty)'}`,
        code: 'VALIDATION'
      }
  }
}
