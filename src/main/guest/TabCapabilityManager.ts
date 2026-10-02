import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import {
  DEFAULT_GUEST_URL,
  type TabCapability,
  type TabInfo
} from '../../shared'
import { GuestTab } from './GuestTab'

export type CreateTabOptions = {
  capability: TabCapability
  url?: string
}

/**
 * Owns all guest tabs and their capability classes.
 * Active / Read-Only get CDP sessions; Privacy never attaches CDP.
 */
export class TabCapabilityManager {
  private readonly tabs = new Map<string, GuestTab>()
  private activeTabId: string | null = null
  private parent: BrowserWindow | null = null
  private slotCounter = 0

  /** Bind to the dashboard window; required before createTab. */
  setParent(parent: BrowserWindow): void {
    this.parent = parent
  }

  listTabs(): { tabs: TabInfo[]; activeTabId: string | null } {
    this.pruneDestroyed()
    const tabs = [...this.tabs.values()].map((t) => t.toInfo())
    return { tabs, activeTabId: this.activeTabId }
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getTab(tabId: string): GuestTab | undefined {
    const tab = this.tabs.get(tabId)
    if (!tab || tab.isDestroyed()) {
      if (tab) this.tabs.delete(tabId)
      return undefined
    }
    return tab
  }

  /**
   * Resolve a tab by explicit id or fall back to the active tab.
   */
  resolveTab(tabId?: string): GuestTab | undefined {
    if (tabId) return this.getTab(tabId)
    if (this.activeTabId) return this.getTab(this.activeTabId)
    return undefined
  }

  createTab(options: CreateTabOptions): TabInfo {
    if (!this.parent || this.parent.isDestroyed()) {
      throw new Error('Dashboard parent window not ready')
    }

    const id = randomUUID()
    const url = options.url ?? DEFAULT_GUEST_URL
    const slot = this.slotCounter++
    const tab = new GuestTab({
      id,
      capability: options.capability,
      parent: this.parent,
      initialUrl: url,
      slot
    })
    tab.create()
    this.tabs.set(id, tab)

    // Prefer Active as default active target for CDP demos.
    if (
      this.activeTabId === null ||
      options.capability === 'active' ||
      !this.getTab(this.activeTabId)
    ) {
      this.activeTabId = id
    }

    return tab.toInfo()
  }

  /** High-level Privacy lifecycle helper (no CDP). */
  openPrivacyTab(url: string): TabInfo {
    return this.createTab({ capability: 'privacy', url })
  }

  setActiveTab(tabId: string): string {
    const tab = this.getTab(tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${tabId}`)
    }
    this.activeTabId = tabId
    tab.focus()
    return tabId
  }

  closeTab(tabId: string): string {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      throw new Error(`Tab not found: ${tabId}`)
    }
    tab.destroy()
    this.tabs.delete(tabId)
    if (this.activeTabId === tabId) {
      const next = this.tabs.keys().next()
      this.activeTabId = next.done ? null : next.value
    }
    return tabId
  }

  /**
   * Ensure at least one Active and one Read-Only demo tab exist.
   * Privacy remains create-on-demand via openPrivacyTab.
   */
  ensureDefaultTabs(): void {
    const caps = new Set(
      [...this.tabs.values()]
        .filter((t) => !t.isDestroyed())
        .map((t) => t.capability)
    )
    if (!caps.has('active')) {
      this.createTab({ capability: 'active', url: DEFAULT_GUEST_URL })
    }
    if (!caps.has('readOnly')) {
      this.createTab({
        capability: 'readOnly',
        url: DEFAULT_GUEST_URL
      })
    }
  }

  destroyAll(): void {
    for (const tab of this.tabs.values()) {
      tab.destroy()
    }
    this.tabs.clear()
    this.activeTabId = null
  }

  private pruneDestroyed(): void {
    for (const [id, tab] of this.tabs) {
      if (tab.isDestroyed()) {
        this.tabs.delete(id)
        if (this.activeTabId === id) {
          this.activeTabId = null
        }
      }
    }
    if (this.activeTabId === null && this.tabs.size > 0) {
      this.activeTabId = this.tabs.keys().next().value ?? null
    }
  }
}
