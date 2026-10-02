import { config as loadDotenv } from 'dotenv'
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc/handlers'
import { TabCapabilityManager } from './guest/TabCapabilityManager'
import { openSessionStore, type SessionStore } from './session'
import { VoiceSession } from './voice/VoiceSession'

// Load `.env` from cwd when present (never commit secrets — see .gitignore).
loadDotenv()

/**
 * Phase 1–5 security defaults (ARCHITECTURE.md):
 * - contextIsolation: true
 * - nodeIntegration: false
 * - sandbox: true
 * Guest WebContents: same isolation; CDP attach only in Main for Active/Read-Only.
 * Privacy tabs: no CDP attach. Zod IPC + capability gate.
 * Voice: Gemini Live proxy in Main; mic capture in renderer; Active tab only.
 * Phase 5: tool binding on Active tab + SessionStore (sql.js SQLite / JSON fallback).
 */
const tabManager = new TabCapabilityManager()
const voiceSession = new VoiceSession()
let sessionStore: SessionStore | null = null

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 960,
    minWidth: 800,
    minHeight: 640,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#0f1419',
    title: '1Browzer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Open external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  tabManager.setParent(mainWindow)
  voiceSession.setDashboard(mainWindow)
  // One Active + one Read-Only guest for CDP demos; Privacy is on-demand.
  tabManager.ensureDefaultTabs()

  mainWindow.on('closed', () => {
    void voiceSession.stop()
    voiceSession.setDashboard(null)
    tabManager.destroyAll()
  })

  return mainWindow
}

app.whenReady().then(async () => {
  const opened = await openSessionStore(app.getPath('userData'))
  sessionStore = opened.store
  console.info(
    `[1browzer] SessionStore backend=${opened.backend} path=${opened.path}`
  )

  voiceSession.setTabManager(tabManager)
  voiceSession.setSessionStore(sessionStore)

  registerIpcHandlers(tabManager, voiceSession, sessionStore)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  void voiceSession.stop()
  tabManager.destroyAll()
  sessionStore?.close()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
