import type { WebContents } from 'electron'
import { type AxNode, MAX_AX_NODES } from '../../shared'
import { trimAxTree, type RawAxNode } from './axTree'

export type AxTreeResult = {
  url: string
  nodes: AxNode[]
  nodeCount: number
  truncated: boolean
}

/**
 * Main-process-only CDP session bound to a guest WebContents.
 * Uses Electron's built-in debugger protocol (no chrome-remote-interface).
 * Never constructed for Privacy tabs (no CDP attach).
 */
export class CdpSession {
  private attached = false
  private domainsEnabled = false

  constructor(private readonly contents: WebContents) {}

  isAttached(): boolean {
    return this.attached && !this.contents.isDestroyed()
  }

  async attach(): Promise<void> {
    if (this.contents.isDestroyed()) {
      throw new Error('Guest WebContents destroyed')
    }
    if (this.attached) return

    try {
      this.contents.debugger.attach('1.3')
    } catch (err) {
      // Already attached is fine.
      const msg = err instanceof Error ? err.message : String(err)
      if (!/already attached/i.test(msg)) {
        throw err
      }
    }
    this.attached = true
    await this.enableDomains()
  }

  detach(): void {
    if (!this.attached || this.contents.isDestroyed()) {
      this.attached = false
      this.domainsEnabled = false
      return
    }
    try {
      this.contents.debugger.detach()
    } catch {
      // ignore detach races
    }
    this.attached = false
    this.domainsEnabled = false
  }

  private async enableDomains(): Promise<void> {
    if (this.domainsEnabled) return
    await this.send('Accessibility.enable')
    await this.send('DOM.enable')
    this.domainsEnabled = true
  }

  private async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    if (!this.isAttached()) {
      throw new Error('CDP not attached')
    }
    return (await this.contents.debugger.sendCommand(
      method,
      params
    )) as T
  }

  async getAxTree(maxNodes?: number): Promise<AxTreeResult> {
    await this.attach()
    const result = await this.send<{ nodes?: RawAxNode[] }>(
      'Accessibility.getFullAXTree'
    )
    const trimmed = trimAxTree(result.nodes, {
      maxNodes: maxNodes ?? MAX_AX_NODES
    })
    return {
      url: this.contents.getURL() || '',
      nodes: trimmed.nodes,
      nodeCount: trimmed.nodeCount,
      truncated: trimmed.truncated
    }
  }

  /**
   * Highlight via DOM.highlightNode using backendDOMNodeId from the AX tree.
   */
  async highlightNode(backendNodeId: number): Promise<void> {
    await this.attach()
    await this.send('DOM.highlightNode', {
      backendNodeId,
      highlightConfig: {
        borderColor: { r: 91, g: 140, b: 255, a: 0.9 },
        contentColor: { r: 91, g: 140, b: 255, a: 0.25 },
        showInfo: true
      }
    })
  }

  async navigate(url: string): Promise<string> {
    if (this.contents.isDestroyed()) {
      throw new Error('Guest WebContents destroyed')
    }
    await this.contents.loadURL(url)
    // Re-enable domains after navigation if debugger stayed attached.
    if (this.attached) {
      this.domainsEnabled = false
      await this.enableDomains()
    }
    return this.contents.getURL()
  }

  /** Expose nodes for UI demos that need to pick a highlight target. */
  static pickHighlightTarget(nodes: AxNode[]): number | undefined {
    const hit = nodes.find(
      (n) =>
        typeof n.backendDOMNodeId === 'number' &&
        n.backendDOMNodeId > 0 &&
        !n.ignored &&
        /^(button|link)$/i.test(n.role)
    )
    return hit?.backendDOMNodeId
  }
}
