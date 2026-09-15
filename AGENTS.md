# QuotaCards - notes for coding agents

A VPN client for Windows and Android that routes per-app and per-quota traffic
through a personal Xray/VLESS server. The phone adds WireGuard (UDP/53) and
Hysteria2 (UDP/443) transports; the PC speaks Standard VLESS only.

## Layout

- `src/` - core Rust: `vpn.rs` (routing rules, per-app policy, WireGuard/Hysteria helpers),
  `server.rs` (server-side provisioning helpers), protocol code shared by both apps.
- `desktop/src-tauri/` - the Windows app: Tauri 2 backend, commands in `src/lib.rs`
  (tray, single instance, signed updater, `tunnel_*`, `generate_card`, `import_card`, `revoke_card`).
- `desktop/ui-next/` - the Windows UI. React 19 + TypeScript + Vite + Tailwind v4 +
  shadcn/ui + Motion + Lucide. This is the shipping UI.
- `desktop/ui/` - the old vanilla UI, kept only as a reference for behaviours the user liked.
- `android/tauri-app/` - Tauri 2 Android app, Kotlin `VpnService`, phone UI in `ui/`
  (vanilla HTML/CSS/JS, not React).
- `android/tauri-plugin-qctunnel/` - the native tunnel plugin, ships `libs/libbox.aar` (27 MB, prebuilt, do not delete).
- `tools/` - `make-icons.py` (all icon sets, desktop + android), `build-apk.sh`, `sync-mobile-assets.sh`.
- `docs/` - `STATUS.md` tracks the current state; read it first.

## Build and verify

Windows, run from git-bash. The toolchain this project was developed against:
`C:/Tools/mingw_extract/mingw64/bin` (MinGW), Android SDK + NDK 28.2.13676358,
`JAVA_HOME` at a JDK 23, Node 22, `tauri-cli` 2.11.4.

- UI: `cd desktop/ui-next && npm install && npm run build`
- Desktop app: `cd desktop/src-tauri && cargo build --release --offline --target x86_64-pc-windows-gnu`
  The dev profile does not link under MinGW (`export ordinal too large`), so always
  verify through a release build. Copy `WebView2Loader.dll` next to the exe to run it.
- Installer: from `desktop/`, `node ../android/tauri-cli-npm/node_modules/@tauri-apps/cli/tauri.js build --bundles nsis --target x86_64-pc-windows-gnu`
  with `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set and NSIS on PATH.
  Produces `bundle/nsis/QuotaCards_<version>_x64-setup.exe` plus its `.sig`.
- Phone: `bash tools/build-apk.sh` (needs `ANDROID_HOME`, and `cygpath` before any native SDK `.exe`).
- Icons: `python tools/make-icons.py`. It trims the master to its content box and verifies every frame;
  run it after touching `res/app-icon-src.png` only.

## Conventions that matter

- **React stack is mandatory for the desktop UI.** Before adding a component, check shadcn/ui;
  before hand-rolling an animation, check Motion. Do not add another UI library.
- **No dropdown menus.** Choices use the searchable list picker (`components/PickerDialog.tsx`)
  with a check on the current value.
- **Theme**: luminous night scene behind everything, every surface a frosted glass pane
  (`index.css` tokens, `.scene`, `.glass*`). Keep `backdrop-filter` free of the `-webkit-` twin:
  Vite's minifier keeps only that one and Chromium then ignores it, killing the blur.
- **All user-visible strings go through `src/lib/i18n/{en,ar}.ts`** (formal Modern Standard Arabic,
  RTL). Never mirror the layout in Arabic, only the text direction.
- **Never emit em-dashes** in code, UI strings, or docs. Plain hyphens only. The user treats
  anything else as an obvious tell.
- **Version lives in four files**: `desktop/src-tauri/{tauri.conf.json,Cargo.toml}` and
  `android/tauri-app/src-tauri/{tauri.conf.json,Cargo.toml}`. Bump all four together.
- **Releases**: bump, build the installer and the APK, then publish the GitHub release with the
  updater feed. The feed asset must be named exactly `latest.json`; the app reads
  `releases/latest/download/latest.json`. Ship both platforms at the same version.
- **Secrets** (keystore, updater key and passwords, the server private key in
  `%APPDATA%/quotacards/config.json`) never enter the repo and never get printed.
- **Commit author for this repository is `YousefMohiey`.** Do not add agent or assistant
  attribution to commits, code comments, or docs.

## Verifying UI work

Run the built UI with `npm run preview` (port 4173) and drive it over CDP. Two traps:
the harness throttles timers in pages it considers background, so enable
`Emulation.setFocusEmulationEnabled` before timing anything, and the animation clock can be
frozen, so measure geometry numerically rather than trusting a screenshot.

## Current state

v0.2.5 is the latest release (installer, APK, `latest.json`). Windows UI is the React app in
`desktop/ui-next`; the phone still runs the vanilla UI. `docs/STATUS.md` has the details.
