import { describe, expect, it } from 'vitest'
import {
  trimAxTree,
  findFirstHighlightable,
  type RawAxNode
} from '../src/main/cdp/axTree'
import { MAX_AX_NODES } from '../src/shared'

function node(
  partial: Partial<RawAxNode> & { nodeId: string | number }
): RawAxNode {
  return {
    role: { value: 'generic' },
    name: { value: '' },
    ...partial
  }
}

describe('trimAxTree', () => {
  it('maps role/name and backendDOMNodeId', () => {
    const result = trimAxTree([
      node({
        nodeId: '1',
        role: { value: 'button' },
        name: { value: 'Go' },
        backendDOMNodeId: 99
      })
    ])
    expect(result.truncated).toBe(false)
    expect(result.nodeCount).toBe(1)
    expect(result.nodes[0]).toEqual({
      axNodeId: 1,
      role: 'button',
      name: 'Go',
      backendDOMNodeId: 99
    })
  })

  it('truncates when over maxNodes and sets truncated flag', () => {
    const raw = Array.from({ length: 10 }, (_, i) =>
      node({ nodeId: i + 1, role: { value: 'text' }, name: { value: `n${i}` } })
    )
    const result = trimAxTree(raw, { maxNodes: 3 })
    expect(result.truncated).toBe(true)
    expect(result.nodeCount).toBe(3)
    expect(result.nodes.map((n) => n.axNodeId)).toEqual([1, 2, 3])
  })

  it('never exceeds hard MAX_AX_NODES even if maxNodes is larger', () => {
    const raw = Array.from({ length: MAX_AX_NODES + 50 }, (_, i) =>
      node({ nodeId: i })
    )
    const result = trimAxTree(raw, { maxNodes: MAX_AX_NODES + 100 })
    expect(result.nodeCount).toBe(MAX_AX_NODES)
    expect(result.truncated).toBe(true)
  })

  it('clips long name strings', () => {
    const long = 'x'.repeat(500)
    const result = trimAxTree(
      [node({ nodeId: 1, name: { value: long }, role: { value: 'text' } })],
      { maxStringChars: 20 }
    )
    expect(result.nodes[0].name.length).toBeLessThanOrEqual(20)
    expect(result.nodes[0].name.endsWith('…')).toBe(true)
  })

  it('handles null/undefined input', () => {
    expect(trimAxTree(null).nodes).toEqual([])
    expect(trimAxTree(undefined).nodeCount).toBe(0)
  })
})

describe('findFirstHighlightable', () => {
  it('finds first button/link with backendDOMNodeId', () => {
    const trimmed = trimAxTree([
      node({ nodeId: 1, role: { value: 'generic' }, backendDOMNodeId: 1 }),
      node({
        nodeId: 2,
        role: { value: 'link' },
        name: { value: 'More' },
        backendDOMNodeId: 7
      }),
      node({
        nodeId: 3,
        role: { value: 'button' },
        name: { value: 'Ok' },
        backendDOMNodeId: 8
      })
    ])
    const hit = findFirstHighlightable(trimmed.nodes)
    expect(hit?.backendDOMNodeId).toBe(7)
    expect(hit?.role).toBe('link')
  })

  it('skips ignored nodes', () => {
    const trimmed = trimAxTree([
      node({
        nodeId: 1,
        role: { value: 'button' },
        backendDOMNodeId: 3,
        ignored: true
      })
    ])
    expect(findFirstHighlightable(trimmed.nodes)).toBeUndefined()
  })
})
