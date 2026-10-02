# 1Browzer — Phase 5: Tool Binding & State

Hands-free, AI-controlled agentic web browser (Electron). This repository implements **Phases 1–5** (MVP complete per ARCHITECTURE.md).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full blueprint.

## Phase 1–4 (summary)

- Secure Electron scaffold (contextIsolation / sandbox / Zod IPC)
- CDP AX tree + highlight + navigate
- Tab Capability Manager (Active / Read-Only / Privacy)
- Gemini Multimodal Live voice proxy (PCM IPC, VAD barge-in, session resumption)

## Phase 5 includes

- **Gemini functionDeclarations** for browser tools, bound on Live connect:
  - `get_ax_tree` (optional `maxNodes`)
  - `highlight_node` (`nodeId` = CDP backendDOMNodeId)
  - `navigate` (http/https `url`)
  - `list_tabs` (read-only metadata: id, capability, url — never Privacy DOM)
- **Synchronous tool loop** in `VoiceSession`: on `toolCall`, uplink PCM pauses, tools run via capability-gated `tabActions` on the **Active** voice tab, then `sendToolResponse` returns capped JSON.
- **SessionStore** persistence for chat/transcript turns across restarts
  - Prefer **sql.js** (real SQLite via WASM) — `better-sqlite3` could not be built here (no `make`)
  - Automatic **JSON file fallback** behind the same interface
- Zod IPC: `session:list`, `session:load`, `session:clear`
- Dashboard: transcript persistence status + Sessions mini-list

### Tool gating matrix

| Tool | Active | Read-Only | Privacy |
|------|--------|-----------|---------|
| `get_ax_tree` (via voice tools) | ✓ | ✗ (tools force Active tab) | ✗ |
| `highlight_node` | ✓ | ✗ `CAPABILITY_DENIED` | ✗ |
| `navigate` | ✓ | ✗ `CAPABILITY_DENIED` | ✗ |
| `list_tabs` | ✓ (metadata only) | ✓ metadata | ✓ metadata (no DOM) |

Mutating tools are **never** attached to non-Active tabs. Voice itself remains Active-only.

### Synchronous tool loop

While tools execute, `VoiceSession` sets an internal `toolLoopActive` flag:

1. Mic uplink PCM is dropped (voice effectively pauses)
2. Model audio downlink is also dropped during the loop
3. Results are size-capped (`TOOL_RESPONSE_MAX_CHARS`) before `sendToolResponse`
4. Flag clears and a system transcript line notes uplink resumed

### Session persistence

| Backend | When |
|---------|------|
| `sqlite` (sql.js WASM) | Default when WASM loads |
| `json` | Fallback if sql.js init fails; also used in unit tests via memory store |

Persists: session id, transcript turns (role/text/ts), timestamps. APIs: list / load last or by id / clear one or all.

## Requirements

- Node.js 20+
- npm
- For live voice + tools: `GEMINI_API_KEY` in `.env`

## Install

```bash
cd /workspace/1browzer
npm install
cp .env.example .env   # then edit GEMINI_API_KEY
```

## Run

```bash
npm run dev
```

> Headless boxes may not show a GUI; use `npm run typecheck`, `npm run build`, and `npm test`.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Electron + Vite HMR |
| `npm run build` | Production build to `out/` |
| `npm run typecheck` | `tsc --noEmit` main/preload + renderer |
| `npm test` | Vitest (no network; MockGeminiLiveClient + SessionStore) |
| `npm run preview` | Preview production build |

## Security defaults (summary)

| Setting | Value |
|---------|-------|
| `contextIsolation` / `nodeIntegration` / `sandbox` | `true` / `false` / `true` |
| API key | Env / `.env` only — never hardcoded or committed |
| Voice + mutating tools | Active Worker only |
| IPC validation | Zod + 64 KiB request cap |
| CDP on Privacy | Never |
| Tool AX payloads | Size-capped before return to model |

## Layout

```
src/
  main/
    voice/         # VoiceSession, GeminiLiveClient, browserTools, toolRouter
    session/       # SessionStore (sql.js + JSON), sessionActions
    capabilities/  # CAPABILITY_DENIED gate
    cdp/ guest/ ipc/
  preload/
  renderer/src/    # Dashboard + Sessions panel + voice audio bridge
  shared/          # Zod schemas, IPC channels, capability matrix
tests/
```

## IPC channels (Phase 5 additions)

| Channel | Request | Response / notes |
|---------|---------|------------------|
| `session:list` | `{}` | `{ ok, backend, sessions[] }` |
| `session:load` | `{ sessionId? }` | `{ ok, backend, session }` — omit id → last session |
| `session:clear` | `{ sessionId? , clearAll? }` | `{ ok, cleared }` — destructive |

## Not in this MVP

- Full WebRTC UDP peer (PCM-over-IPC remains the uplink path)
- CDP Input domain click/type dispatch beyond navigate/highlight
- Plan-Then-Execute / Untrusted Content Masking (UCM) hardening pass
- Multi-tab tool routing (tools always bind to the voice Active tab)

## Demo checklist (human + real API key + display)

1. Copy `.env.example` → `.env` and set `GEMINI_API_KEY`
2. `npm run dev` on a machine with a display + microphone
3. Ensure an **Active** tab is selected; Start voice
4. Ask the model to list tabs, fetch the AX tree, highlight a control, or navigate
5. Confirm tool lines appear in the transcript; Sessions panel shows persistence backend
6. Restart the app; Load last session from the Sessions list

## GitHub Codespaces

Open this repo in Codespaces (browser → green **Code** → **Codespaces** → **Create codespace on main**).

The `.devcontainer` image includes Node 20 and runs `npm install` on create. Then:

```bash
npm run typecheck
npm test
npm run build
```

See [docs/ANDROID.md](./docs/ANDROID.md) for why this MVP does not yet emit a Google Play APK.
