/**
 * Gemini Live functionDeclarations for browser tools (Phase 5).
 * Mutating tools + get_ax_tree are bound to the Active voice tab only.
 */

import { Type, type FunctionDeclaration, type Tool } from '@google/genai'

/** Soft cap on AX nodes returned to the model via tools. */
export const TOOL_AX_MAX_NODES = 150

/** Hard char cap on serialized tool responses sent back to the model. */
export const TOOL_RESPONSE_MAX_CHARS = 24_000

export const BROWSER_TOOL_NAMES = [
  'get_ax_tree',
  'highlight_node',
  'navigate',
  'list_tabs'
] as const

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number]

export const BROWSER_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_ax_tree',
    description:
      'Fetch a trimmed accessibility tree for the Active Worker tab. Returns capped JSON (role/name/ids). Use before highlighting.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        maxNodes: {
          type: Type.NUMBER,
          description: `Optional soft cap on nodes (max ${TOOL_AX_MAX_NODES}).`
        }
      }
    }
  },
  {
    name: 'highlight_node',
    description:
      'Highlight a DOM node on the Active Worker tab using CDP backendDOMNodeId from get_ax_tree.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nodeId: {
          type: Type.NUMBER,
          description: 'CDP backendDOMNodeId (from AX tree backendDOMNodeId).'
        }
      },
      required: ['nodeId']
    }
  },
  {
    name: 'navigate',
    description:
      'Navigate the Active Worker tab to an http(s) URL. Denied for Privacy / Read-Only.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'Absolute http or https URL.'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'list_tabs',
    description:
      'List open tabs as read-only metadata (id, capability, url). Never returns Privacy DOM/AX content.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  }
]

/** Tools array shape expected by @google/genai Live connect config. */
export function buildBrowserTools(): Tool[] {
  return [{ functionDeclarations: BROWSER_FUNCTION_DECLARATIONS }]
}

/**
 * Cap JSON payload size for model tool responses.
 * Prefer truncating arrays named `nodes` when present.
 */
export function capToolResponsePayload(value: unknown): unknown {
  const json = safeStringify(value)
  if (json.length <= TOOL_RESPONSE_MAX_CHARS) {
    return value
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) }
    if (Array.isArray(obj.nodes)) {
      let nodes = obj.nodes as unknown[]
      while (
        nodes.length > 1 &&
        safeStringify({ ...obj, nodes }).length > TOOL_RESPONSE_MAX_CHARS
      ) {
        nodes = nodes.slice(0, Math.max(1, Math.floor(nodes.length * 0.7)))
      }
      obj.nodes = nodes
      obj.truncated = true
      obj.nodeCount = nodes.length
      if (safeStringify(obj).length <= TOOL_RESPONSE_MAX_CHARS) {
        return obj
      }
    }
  }

  return {
    ok: false,
    error: 'Tool result exceeded size cap',
    code: 'OVERSIZE',
    preview: json.slice(0, 500)
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return String(value)
  }
}
