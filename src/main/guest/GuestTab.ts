import { BrowserWindow, type WebContents } from 'electron'
import { CdpSession } from '../cdp/CdpSession'
import {
  getPermissions,
  type TabCapability,
  type TabInfo
} from '../../shared'

export type GuestTabOptions = {
  id: string
  capability: TabCapability
  parent: BrowserWindow
  initialUrl: string
  /** Cascade offset index for window placement. */
  slot?: number
}

/**
 * One guest BrowserWindow with an id + capability class.
 * Security: no Node, no privileged preload, sandboxed, isolated.
 * CDP session is created only when capability.canCdpAttach is true.
 */
export class GuestTab {
  readonly id: string
  readonly capability: TabCapability
  private window: BrowserWindow | null = null
  private session: CdpSession | null = null
  private title = ''

  constructor(private readonly options: GuestTabOptions) {
    this.id = options.id
    this.capability = options.capability
  }

  create(): void {
    const { parent, initialUrl, slot = 0 } = this.options
    const parentBounds = parent.getBounds()
    const offset = (slot % 5) * 28
    const perms = getPermissions(this.capability)

    this.window = new BrowserWindow({
      parent,
      width: Math.max(640, Math.floor(parentBounds.width * 0.85)),
      height: 480,
      x: parentBounds.x + 40 + offset,
      y: parentBounds.y + Math.min(parentBounds.height - 40, 360) + offset,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      title: `1Browzer Guest [${this.capability}]`,
      webPreferences: {
        // Guest must never get Node or a privileged preload.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    })

    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    this.window.on('ready-to-show', () => {
      this.window?.show()
    })

    this.window.webContents.on('page-title-updated', (_e, title) => {
      this.title = title
    })

    void this.window.loadURL(initialUrl)

    // Privacy: never attach CDP. Active / Read-Only: attach after first load.
    if (perms.canCdpAttach) {
      this.session = new CdpSession(this.window.webContents)
      this.window.webContents.once('did-finish-load', () => {
        void this.session?.attach().catch(() => {
          // Non-fatal at boot; handlers will retry on first IPC call.
        })
      })
    } else {
      this.session = null
    }

    this.window.on('closed', () => {
      this.session?.detach()
      this.session = null
      this.window = null
    })
  }

  getWebContents(): WebContents | null {
    if (!this.window || this.window.isDestroyed()) return null
    return this.window.webContents
  }

  /**
   * CDP session, or null for Privacy (and destroyed tabs).
   * Callers must still capability-gate before using mutation APIs.
   */
  getSession(): CdpSession | null {
    return this.session
  }

  getUrl(): string {
    const wc = this.getWebContents()
    return wc?.getURL() ?? ''
  }

  getTitle(): string {
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      const t = wc.getTitle()
      if (t) this.title = t
    }
    return this.title
  }

  toInfo(): TabInfo {
    const perms = getPermissions(this.capability)
    return {
      id: this.id,
      capability: this.capability,
      url: this.getUrl(),
      title: this.getTitle(),
      canInput: perms.canInput,
      canCdpAttach: perms.canCdpAttach
    }
  }

  /** Privacy / lifecycle load without CDP (also used internally). */
  async loadUrl(url: string): Promise<string> {
    const wc = this.getWebContents()
    if (!wc) {
      throw new Error('Guest WebContents destroyed')
    }
    await wc.loadURL(url)
    return wc.getURL()
  }

  focus(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus()
      this.window.show()
    }
  }

  destroy(): void {
    this.session?.detach()
    this.session = null
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  isDestroyed(): boolean {
    return !this.window || this.window.isDestroyed()
  }
}
