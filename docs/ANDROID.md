# Android / Google Play status

1Browzer v0.5.0 is an **Electron desktop** app (Chromium + Node main process + CDP). Electron does **not** produce Google Play APK/AAB artifacts.

## What Codespaces verifies today
- `npm install`
- `npm run typecheck`
- `npm test`
- `npm run build` → Electron main/preload/renderer bundles under `out/`

## Path to Play Store (future work, not in MVP)
1. Extract the renderer / agent UI into a web or Capacitor shell, **or**
2. Rebuild the agent shell on Android WebView + a native bridge for mic/CDP-equivalent automation (Play Protect and accessibility APIs differ sharply from desktop CDP).

Do **not** expect `npm run build` in this repo to emit an `.apk` or `.aab`.
