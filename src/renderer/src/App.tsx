import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AxNode, TabInfo, VoiceEvent } from '../../shared/schemas'
import type { TabCapability } from '../../shared/capabilities'
import type { VoiceSessionState } from '../../shared/voice'
import { MicCapture, PcmPlayer } from './voice/audioBridge'

type IpcResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; code: string }
  | null

export default function App(): JSX.Element {
  const [pingResult, setPingResult] = useState<IpcResult>(null)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('https://example.com')
  const [privacyUrl, setPrivacyUrl] = useState('https://example.com')
  const [axNodes, setAxNodes] = useState<AxNode[]>([])
  const [axMeta, setAxMeta] = useState<{
    url: string
    nodeCount: number
    truncated: boolean
    tabId: string
  } | null>(null)
  const [cdpStatus, setCdpStatus] = useState<IpcResult>(null)
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  /** Which CDP-capable guest (Active or Read-Only) demos target. */
  const [cdpTargetId, setCdpTargetId] = useState<string | null>(null)
  const [tabsError, setTabsError] = useState<string | null>(null)

  // Phase 4 voice
  const [voiceState, setVoiceState] = useState<VoiceSessionState>('idle')
  const [voiceHasKey, setVoiceHasKey] = useState(false)
  const [voiceStatusLine, setVoiceStatusLine] = useState<string>('idle')
  const [transcriptLog, setTranscriptLog] = useState<
    { role: string; text: string; stub?: boolean }[]
  >([])
  const [sessionBackend, setSessionBackend] = useState<string>('unknown')
  const [sessionSummaries, setSessionSummaries] = useState<
    { id: string; updatedAt: number; turnCount: number; preview: string }[]
  >([])
  const [sessionStatus, setSessionStatus] = useState<string>('Persistence: …')
  const [voiceBusy, setVoiceBusy] = useState(false)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)

  const previewNodes = useMemo(() => axNodes.slice(0, 20), [axNodes])

  const activeTabs = useMemo(
    () => tabs.filter((t) => t.capability === 'active'),
    [tabs]
  )
  /** Voice binds to Active Worker only. */
  const voiceTabId = useMemo(() => {
    const preferred =
      activeTabs.find((t) => t.id === activeTabId) ?? activeTabs[0]
    return preferred?.id ?? null
  }, [activeTabs, activeTabId])
  const readOnlyTabs = useMemo(
    () => tabs.filter((t) => t.capability === 'readOnly'),
    [tabs]
  )
  const privacyTabs = useMemo(
    () => tabs.filter((t) => t.capability === 'privacy'),
    [tabs]
  )

  const cdpTargets = useMemo(
    () =>
      tabs.filter(
        (t) => t.capability === 'active' || t.capability === 'readOnly'
      ),
    [tabs]
  )

  const refreshTabs = useCallback(async (): Promise<void> => {
    const result = await window.onebrowzer.listTabs()
    if (!result.ok) {
      setTabsError(result.error)
      return
    }
    setTabsError(null)
    const nextTabs = result.tabs
    setTabs(nextTabs)
    setActiveTabId(result.activeTabId)
    setCdpTargetId((prev) => {
      const stillThere =
        prev &&
        nextTabs.some(
          (t: TabInfo) =>
            t.id === prev &&
            (t.capability === 'active' || t.capability === 'readOnly')
        )
      if (stillThere) return prev
      const preferred =
        nextTabs.find((t: TabInfo) => t.capability === 'active') ??
        nextTabs.find((t: TabInfo) => t.capability === 'readOnly')
      return preferred?.id ?? null
    })
  }, [])

  useEffect(() => {
    void refreshTabs()
  }, [refreshTabs])

  const refreshSessions = useCallback(async (): Promise<void> => {
    const result = await window.onebrowzer.sessionList()
    if (!result.ok) {
      setSessionStatus(`Persistence error: ${result.error}`)
      return
    }
    setSessionBackend(result.backend)
    setSessionSummaries(
      result.sessions.slice(0, 8).map((s: {
        id: string
        updatedAt: number
        turnCount: number
        preview: string
      }) => ({
        id: s.id,
        updatedAt: s.updatedAt,
        turnCount: s.turnCount,
        preview: s.preview
      }))
    )
    setSessionStatus(
      result.sessions.length === 0
        ? `Persistence: ${result.backend} · no sessions yet`
        : `Persistence: ${result.backend} · ${result.sessions.length} session(s)`
    )
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])


  useEffect(() => {
    let cancelled = false
    void (async () => {
      const st = await window.onebrowzer.voiceStatus()
      if (cancelled || !st.ok) return
      setVoiceState(st.state)
      setVoiceHasKey(st.hasApiKey)
      setVoiceStatusLine(
        `${st.state}${st.tabId ? ` · tab ${st.tabId.slice(0, 8)}…` : ''}${
          st.hasApiKey ? '' : ' · no API key'
        }`
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const player = new PcmPlayer()
    playerRef.current = player
    const unsub = window.onebrowzer.onVoiceEvent((ev: VoiceEvent) => {
      if (ev.type === 'status') {
        setVoiceState(ev.state)
        setVoiceStatusLine(
          `${ev.state}${ev.tabId ? ` · tab ${ev.tabId.slice(0, 8)}…` : ''}${
            ev.detail ? ` · ${ev.detail}` : ''
          }`
        )
      } else if (ev.type === 'transcript') {
        setTranscriptLog((prev) =>
          [...prev, { role: ev.role, text: ev.text, stub: ev.stub }].slice(-80)
        )
      } else if (ev.type === 'pcmOut') {
        player.enqueue(ev.pcmBase64, ev.sampleRateHz)
        micRef.current?.setPlaybackActive(true)
      } else if (ev.type === 'interrupted') {
        player.flush()
        micRef.current?.setPlaybackActive(false)
      } else if (ev.type === 'error') {
        setTranscriptLog((prev) =>
          [
            ...prev,
            { role: 'system', text: `error (${ev.code}): ${ev.error}` }
          ].slice(-80)
        )
      }
    })
    player.setActiveChangeListener((active) => {
      micRef.current?.setPlaybackActive(active)
    })
    return () => {
      unsub()
      player.stop()
      playerRef.current = null
      micRef.current?.stop()
      micRef.current = null
    }
  }, [])

  async function handlePing(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.onebrowzer.ping({ nonce: `ui-${Date.now()}` })
      setPingResult(result)
    } catch (err) {
      setPingResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'INTERNAL'
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(capability: TabCapability): Promise<void> {
    setBusy(true)
    try {
      const result = await window.onebrowzer.createTab({
        capability,
        url: url.trim() || undefined
      })
      if (!result.ok) {
        setCdpStatus(result)
      } else if (capability === 'active' || capability === 'readOnly') {
        setCdpTargetId(result.tab.id)
      }
      await refreshTabs()
    } finally {
      setBusy(false)
    }
  }

  async function handleSetActive(tabId: string): Promise<void> {
    setBusy(true)
    try {
      await window.onebrowzer.setActiveTab({ tabId })
      await refreshTabs()
    } finally {
      setBusy(false)
    }
  }

  async function handleClose(tabId: string): Promise<void> {
    setBusy(true)
    try {
      await window.onebrowzer.closeTab({ tabId })
      if (cdpTargetId === tabId) {
        setAxNodes([])
        setAxMeta(null)
      }
      await refreshTabs()
    } finally {
      setBusy(false)
    }
  }

  async function handleOpenPrivacy(): Promise<void> {
    setBusy(true)
    setCdpStatus(null)
    try {
      const result = await window.onebrowzer.openPrivacyTab({
        url: privacyUrl.trim()
      })
      setCdpStatus(result)
      await refreshTabs()
    } catch (err) {
      setCdpStatus({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'INTERNAL'
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleNavigate(): Promise<void> {
    if (!cdpTargetId) return
    setBusy(true)
    setCdpStatus(null)
    try {
      const result = await window.onebrowzer.navigate({
        tabId: cdpTargetId,
        url: url.trim()
      })
      setCdpStatus(result)
      if (result.ok) {
        setAxNodes([])
        setAxMeta(null)
      }
      await refreshTabs()
    } catch (err) {
      setCdpStatus({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'INTERNAL'
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleFetchAx(): Promise<void> {
    if (!cdpTargetId) return
    setBusy(true)
    setCdpStatus(null)
    try {
      const result = await window.onebrowzer.getAxTree({
        tabId: cdpTargetId,
        maxNodes: 400
      })
      setCdpStatus(result)
      if (result.ok) {
        setAxNodes(result.nodes)
        setAxMeta({
          url: result.url,
          nodeCount: result.nodeCount,
          truncated: result.truncated,
          tabId: result.tabId
        })
      } else {
        setAxNodes([])
        setAxMeta(null)
      }
    } catch (err) {
      setCdpStatus({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'INTERNAL'
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleHighlightDemo(): Promise<void> {
    if (!cdpTargetId) return
    setBusy(true)
    setCdpStatus(null)
    try {
      let nodes = axNodes
      if (nodes.length === 0 || axMeta?.tabId !== cdpTargetId) {
        const tree = await window.onebrowzer.getAxTree({
          tabId: cdpTargetId,
          maxNodes: 400
        })
        if (!tree.ok) {
          setCdpStatus(tree)
          return
        }
        nodes = tree.nodes
        setAxNodes(tree.nodes)
        setAxMeta({
          url: tree.url,
          nodeCount: tree.nodeCount,
          truncated: tree.truncated,
          tabId: tree.tabId
        })
      }

      const target = nodes.find(
        (n) =>
          typeof n.backendDOMNodeId === 'number' &&
          n.backendDOMNodeId > 0 &&
          !n.ignored &&
          /^(button|link)$/i.test(n.role)
      )

      if (!target?.backendDOMNodeId) {
        setCdpStatus({
          ok: false,
          error: 'No button/link with backendDOMNodeId in AX tree',
          code: 'CDP'
        })
        return
      }

      const result = await window.onebrowzer.highlightNode({
        tabId: cdpTargetId,
        nodeId: target.backendDOMNodeId
      })
      setCdpStatus(
        result.ok
          ? {
              ok: true,
              highlighted: target.role,
              name: target.name,
              nodeId: target.backendDOMNodeId,
              tabId: result.tabId
            }
          : result
      )
    } catch (err) {
      setCdpStatus({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: 'INTERNAL'
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleVoiceStart(): Promise<void> {
    if (!voiceTabId) {
      setTranscriptLog((prev) =>
        [
          ...prev,
          { role: 'system', text: 'No Active tab — create one before starting voice' }
        ].slice(-80)
      )
      return
    }
    setVoiceBusy(true)
    try {
      const result = await window.onebrowzer.voiceStart({ tabId: voiceTabId })
      if (!result.ok) {
        setTranscriptLog((prev) =>
          [
            ...prev,
            { role: 'system', text: `${result.code}: ${result.error}` }
          ].slice(-80)
        )
        setVoiceStatusLine(`${result.code}: ${result.error}`)
        return
      }
      setVoiceState(result.state)
      setTranscriptLog((prev) =>
        [
          ...prev,
          {
            role: 'system',
            text: `started · ${result.model}${result.resumed ? ' (resumed)' : ''}`
          }
        ].slice(-80)
      )
      // Start mic after Main session is live
      const mic = new MicCapture({
        onPcmIn: (pcmBase64, sampleRateHz) => {
          window.onebrowzer.voicePcmIn({ pcmBase64, sampleRateHz })
        },
        onVadInterrupt: () => {
          playerRef.current?.flush()
          void window.onebrowzer.voiceInterrupt()
        },
        onError: (message) => {
          setTranscriptLog((prev) =>
            [...prev, { role: 'system', text: message }].slice(-80)
          )
        }
      })
      micRef.current?.stop()
      micRef.current = mic
      try {
        await mic.start()
      } catch (err) {
        setTranscriptLog((prev) =>
          [
            ...prev,
            {
              role: 'system',
              text: `mic: ${err instanceof Error ? err.message : String(err)}`
            }
          ].slice(-80)
        )
      }
    } finally {
      setVoiceBusy(false)
    }
  }

  async function handleVoiceStop(): Promise<void> {
    setVoiceBusy(true)
    try {
      micRef.current?.stop()
      micRef.current = null
      playerRef.current?.flush()
      const result = await window.onebrowzer.voiceStop()
      if (result.ok) setVoiceState(result.state)
      else {
        setTranscriptLog((prev) =>
          [
            ...prev,
            { role: 'system', text: `${result.code}: ${result.error}` }
          ].slice(-80)
        )
      }
    } finally {
      setVoiceBusy(false)
    }
  }

  function renderTabList(
    list: TabInfo[],
    empty: string,
    opts?: { pickCdp?: boolean; showClose?: boolean }
  ): JSX.Element {
    if (list.length === 0) {
      return <p className="tab-empty">{empty}</p>
    }
    return (
      <ul className="tab-list">
        {list.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={
                opts?.pickCdp && cdpTargetId === t.id
                  ? 'tab-chip selected'
                  : 'tab-chip'
              }
              onClick={() => {
                if (opts?.pickCdp) setCdpTargetId(t.id)
                void handleSetActive(t.id)
              }}
              disabled={busy}
              title={t.url}
            >
              <span className="tab-cap">{t.capability}</span>
              <span className="tab-url">{t.url || '(loading…)'}</span>
              {t.canInput && <em className="tab-flag">input</em>}
            </button>
            {opts?.showClose !== false && (
              <button
                type="button"
                className="tab-close"
                onClick={() => void handleClose(t.id)}
                disabled={busy}
                aria-label={`Close tab ${t.id}`}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    )
  }

  const selectedTarget = cdpTargets.find((t) => t.id === cdpTargetId)

  return (
    <div className="app">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand">
          <span className="logo">1B</span>
          <h1>1Browzer</h1>
        </div>
        <span className="phase-badge">Phase 5 · Tools & Session State</span>
      </header>

      <main className="content">
        <section className="hero">
          <h2>Capability-based tab groups</h2>
          <p>
            Active Worker has full CDP (AX, highlight, navigate,{' '}
            <code>canInput</code>). Read-Only may fetch AX but mutations are
            rejected with <code>CAPABILITY_DENIED</code>. Privacy never attaches
            CDP — open/close only.
          </p>
          {tabsError && <p className="err-inline">{tabsError}</p>}
        </section>

        <section className="groups">
          <article className="card">
            <h3>Active Worker</h3>
            <p>Full CDP automation surface. Select a tab for demos below.</p>
            <span className="tag ok-tag">canInput</span>
            {renderTabList(activeTabs, 'No Active tabs yet.', {
              pickCdp: true
            })}
            <button
              type="button"
              className="secondary"
              onClick={() => void handleCreate('active')}
              disabled={busy}
            >
              + Active tab
            </button>
          </article>

          <article className="card">
            <h3>Read-Only</h3>
            <p>
              AX/DOM read OK. Highlight, navigate, and Input denied at Main.
            </p>
            <span className="tag">AX only</span>
            {renderTabList(readOnlyTabs, 'No Read-Only tabs yet.', {
              pickCdp: true
            })}
            <button
              type="button"
              className="secondary"
              onClick={() => void handleCreate('readOnly')}
              disabled={busy}
            >
              + Read-Only tab
            </button>
          </article>

          <article className="card privacy-card">
            <h3>Privacy</h3>
            <p>No CDP / no AX panel. Lifecycle open & close only.</p>
            <span className="tag warn-tag">no CDP</span>
            {renderTabList(privacyTabs, 'No Privacy tabs open.')}
            <div className="privacy-row">
              <input
                className="url-input"
                type="url"
                value={privacyUrl}
                onChange={(e) => setPrivacyUrl(e.target.value)}
                placeholder="https://…"
                disabled={busy}
                aria-label="Privacy URL"
              />
              <button
                type="button"
                onClick={() => void handleOpenPrivacy()}
                disabled={busy}
              >
                Open Privacy
              </button>
            </div>
          </article>
        </section>

        <section className="voice-panel">
          <h3>Voice (Active Worker only)</h3>
          <p>
            Gemini Multimodal Live proxy in Main with Phase 5 browser tools
            (get_ax_tree / highlight_node / navigate / list_tabs). Mic → PCM
            IPC → Live WSS; voice pauses during the sync tool loop. Binds to{' '}
            {voiceTabId ? (
              <>
                Active tab <code>{voiceTabId.slice(0, 8)}…</code>
              </>
            ) : (
              <em>no Active tab</em>
            )}
            . Privacy / Read-Only starts are rejected with{' '}
            <code>CAPABILITY_DENIED</code>. Missing key → <code>NO_API_KEY</code>
            {voiceHasKey ? '' : ' (set GEMINI_API_KEY in .env)'}.
          </p>
          <div className="voice-row">
            <button
              type="button"
              onClick={() => void handleVoiceStart()}
              disabled={
                voiceBusy ||
                !voiceTabId ||
                voiceState === 'live' ||
                voiceState === 'connecting'
              }
            >
              Start voice
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void handleVoiceStop()}
              disabled={voiceBusy || voiceState === 'idle'}
            >
              Stop
            </button>
            <span className="voice-status" data-state={voiceState}>
              {voiceStatusLine}
            </span>
          </div>
          <div
            className="transcript-log"
            role="log"
            aria-label="Voice transcript"
          >
            {transcriptLog.length === 0 ? (
              <p className="tab-empty">Transcript log (stub until live key)…</p>
            ) : (
              <ul>
                {transcriptLog.map((line, i) => (
                  <li key={`${i}-${line.role}`}>
                    <code>{line.role}</code>
                    <span>
                      {line.text}
                      {line.stub ? ' · stub' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        
        <section className="sessions-panel">
          <h3>Sessions</h3>
          <p>
            Chat/transcript persistence across restarts ({sessionStatus}).
            Tools bind only to the Active voice tab; Privacy never receives mutating
            tools.
          </p>
          <div className="voice-row">
            <button
              type="button"
              className="secondary"
              onClick={() => void refreshSessions()}
              disabled={busy}
            >
              Refresh sessions
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void (async () => {
                  const r = await window.onebrowzer.sessionClear({ clearAll: true })
                  if (r.ok) {
                    setSessionStatus(`Cleared ${r.cleared} session(s) · ${sessionBackend}`)
                    await refreshSessions()
                  } else {
                    setSessionStatus(`${r.code}: ${r.error}`)
                  }
                })()
              }}
              disabled={busy || sessionSummaries.length === 0}
            >
              Clear all sessions
            </button>
            <span className="voice-status">{sessionStatus}</span>
          </div>
          {sessionSummaries.length === 0 ? (
            <p className="tab-empty">No saved sessions yet — start voice to persist turns.</p>
          ) : (
            <ul className="session-list">
              {sessionSummaries.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="tab-chip"
                    onClick={() => {
                      void (async () => {
                        const r = await window.onebrowzer.sessionLoad({
                          sessionId: s.id
                        })
                        if (!r.ok || !r.session) {
                          setSessionStatus(
                            r.ok ? 'Session empty' : `${r.code}: ${r.error}`
                          )
                          return
                        }
                        setTranscriptLog(
                          r.session.turns.map((tr: {
                            role: string
                            text: string
                            stub?: boolean
                          }) => ({
                            role: tr.role,
                            text: tr.text,
                            stub: tr.stub
                          }))
                        )
                        setSessionStatus(
                          `Loaded ${r.session.id.slice(0, 8)}… · ${r.session.turns.length} turns`
                        )
                      })()
                    }}
                    title={s.preview}
                  >
                    <span className="tab-cap">{s.turnCount} turns</span>
                    <span className="tab-url">
                      {s.preview || s.id.slice(0, 8) + '…'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cdp-panel">
          <h3>CDP demos (Active / Read-Only only)</h3>
          <p>
            Target:{' '}
            {selectedTarget ? (
              <>
                <strong>{selectedTarget.capability}</strong> ·{' '}
                <code>{selectedTarget.id.slice(0, 8)}…</code>
                {selectedTarget.capability === 'readOnly' && (
                  <> — highlight/navigate should return CAPABILITY_DENIED</>
                )}
              </>
            ) : (
              <em>select an Active or Read-Only tab above</em>
            )}
          </p>
          <div className="cdp-row">
            <input
              className="url-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={busy || !cdpTargetId}
              aria-label="Guest URL"
            />
            <button
              type="button"
              onClick={() => void handleNavigate()}
              disabled={busy || !cdpTargetId}
            >
              Navigate
            </button>
            <button
              type="button"
              onClick={() => void handleFetchAx()}
              disabled={busy || !cdpTargetId}
            >
              Fetch AX Tree
            </button>
            <button
              type="button"
              onClick={() => void handleHighlightDemo()}
              disabled={busy || !cdpTargetId}
            >
              Highlight first button/link
            </button>
          </div>

          {axMeta && (
            <p className="ax-meta">
              {axMeta.nodeCount} nodes
              {axMeta.truncated ? ' (truncated)' : ''} · {axMeta.url}
            </p>
          )}

          {previewNodes.length > 0 && (
            <div className="ax-scroll" role="region" aria-label="AX tree preview">
              <ul>
                {previewNodes.map((n) => (
                  <li key={n.axNodeId}>
                    <code>{n.role}</code>
                    <span>{n.name || '—'}</span>
                    {n.backendDOMNodeId != null && (
                      <em>#{n.backendDOMNodeId}</em>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cdpStatus && (
            <pre className={cdpStatus.ok ? 'ok' : 'err'}>
              {JSON.stringify(cdpStatus, null, 2)}
            </pre>
          )}
        </section>

        <section className="ipc-demo">
          <h3>IPC bridge smoke test</h3>
          <p>
            Renderer → preload contextBridge → Main Zod validation → response.
            Active tab id: {activeTabId?.slice(0, 8) ?? 'none'}…
          </p>
          <button type="button" onClick={() => void handlePing()} disabled={busy}>
            {busy ? 'Busy…' : 'Ping'}
          </button>
          {pingResult && (
            <pre className={pingResult.ok ? 'ok' : 'err'}>
              {JSON.stringify(pingResult, null, 2)}
            </pre>
          )}
        </section>

        <div className="guest-spacer" aria-hidden="true" />
      </main>
    </div>
  )
}
