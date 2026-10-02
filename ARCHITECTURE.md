# Architectural Blueprint and Technical Specification for an Autonomous, Voice-Driven Agentic Web Browser

## Engineering objective
Fully hands-free, AI-controlled web browser MVP: continuous DOM awareness, ultra-low latency voice, capability-based tab isolation, minimal frameless UI so the user can watch the AI work.

Standalone Electron desktop app (not an extension). Gemini Multimodal Live for voice. Chrome DevTools Protocol (CDP) for control. Information Flow Control (IFC) for security. Incremental build via Google Jules phases.

## Market context
Compete with agentic browsers (e.g. Perplexity Comet): Chromium chassis + real-time DOM/"Semantic Work Graph". Defend against Indirect Prompt Injection (CometJacking) via structural IFC — tab groups: Active Worker, Read-Only, Privacy.

## Core framework: Electron
- Prefer Electron over Tauri for deterministic Chromium DOM/AX across platforms and multi BrowserView/WebContentsView for capability groups.
- Main Process (Node) + Renderer Processes.
- Security: contextIsolation true, nodeIntegration false for remote content, sandbox true for all WebContents.
- IPC: preload.js via contextBridge; Zod/Valibot schema validation on Main Process.

## Capability-based tab groups (IFC)
### Active Worker
Full automation (CDP Input domain). Plan-Then-Execute; Untrusted Content Masking (UCM) on Accessibility Tree before execution-phase LLM context.

### Read-Only Worker
Accessibility + DOM enabled; Input + Runtime execution disabled at Main Process. Safe ingest / read-aloud. IPC rejects mutation commands.

### Privacy / Lifecycle Worker
No CDP attachment. High-level API only: openPrivacyTab(url), closeTab(id). Zero DOM visibility (banking, auth, personal email).

## Perception: CDP Accessibility Tree
- Accessibility.getFullAXTree (~200–500 tokens vs raw HTML).
- Flattens Shadow DOM; parallel CDP across iframes, stitch unified tree.
- Visual feedback: DOM.getBoxModel / DOMSnapshot; DOM.highlightNode before Input.dispatchMouseEvent/KeyEvent.

## Voice: Gemini Multimodal Live
- Model: gemini-3.1-flash-live-preview (audio-to-audio over WSS).
- Client audio via WebRTC (UDP) + local proxy to Gemini WebSocket (avoid TCP HoL blocking).
- VAD barge-in (flush playback + audioStreamEnd/ActivityEnd); Web Audio AEC.
- SessionResumptionConfig (~10 min WS lifetime, goAway at T-60s); ContextWindowCompressionConfig (~25 tokens/sec audio); SQLite for long-term chat persistence.
- Tools: synchronous function calling + Structured Outputs / JSON Schema; toolResponse returns updated AX tree.

## UI
- Default: frameless transparent fullscreen, chrome hidden, voice-only; highlight overlays for agent actions.
- Dashboard: FAB → config UI with three tab groups, API keys, VAD sensitivity, live transcript of voice + tool calls.

## Jules / build phases
1. Secure Scaffold — Electron+TS, isolation, Zod IPC, React renderer
2. CDP Integration — chrome-remote-interface, AX tree, highlightNode
3. Tab Capability Manager — Active / Read-Only / Privacy + IPC rejection tests
4. Voice & WebRTC Proxy — @google/genai, 16kHz in / 24kHz out PCM, VAD
5. Tool Binding & State — Gemini function declarations, SessionResumption, SQLite

## Sources (from brief)
- Perplexity Comet guides / reversing / semantic work graph writeups
- Witness AI browser agent security; arXiv agent security systems paper
- Electron BrowserView docs
