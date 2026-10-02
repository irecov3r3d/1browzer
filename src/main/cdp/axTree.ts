import {
  MAX_AX_NODES,
  MAX_AX_STRING_CHARS,
  type AxNode
} from '../../shared'

/** Raw CDP Accessibility.AXNode (subset we care about). */
export type RawAxNode = {
  nodeId: string | number
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  backendDOMNodeId?: number
  childIds?: string[]
}

export type TrimAxTreeResult = {
  nodes: AxNode[]
  nodeCount: number
  truncated: boolean
}

function clip(value: string | undefined, max: number): string {
  if (!value) return ''
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function toAxNodeId(raw: string | number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = Number.parseInt(String(raw), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Trim / serialize a CDP Accessibility.getFullAXTree payload for IPC.
 * Pure — unit-testable without Electron.
 */
export function trimAxTree(
  rawNodes: RawAxNode[] | undefined | null,
  options?: { maxNodes?: number; maxStringChars?: number }
): TrimAxTreeResult {
  const maxNodes = Math.min(
    options?.maxNodes ?? MAX_AX_NODES,
    MAX_AX_NODES
  )
  const maxChars = options?.maxStringChars ?? MAX_AX_STRING_CHARS
  const source = Array.isArray(rawNodes) ? rawNodes : []

  const truncated = source.length > maxNodes
  const slice = truncated ? source.slice(0, maxNodes) : source

  const nodes: AxNode[] = slice.map((n) => {
    const node: AxNode = {
      axNodeId: toAxNodeId(n.nodeId),
      role: clip(n.role?.value, maxChars) || 'unknown',
      name: clip(n.name?.value, maxChars)
    }
    if (typeof n.backendDOMNodeId === 'number') {
      node.backendDOMNodeId = n.backendDOMNodeId
    }
    if (n.ignored === true) {
      node.ignored = true
    }
    return node
  })

  return {
    nodes,
    nodeCount: nodes.length,
    truncated
  }
}

/** Find first interactive button or link with a backend DOM id. */
export function findFirstHighlightable(
  nodes: AxNode[]
): AxNode | undefined {
  const interactive = new Set(['button', 'link', 'Link', 'Button'])
  return nodes.find(
    (n) =>
      typeof n.backendDOMNodeId === 'number' &&
      n.backendDOMNodeId > 0 &&
      !n.ignored &&
      interactive.has(n.role)
  )
}
