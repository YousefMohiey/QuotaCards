# QuotaVPN handoff

Read this first, then `docs/STATUS.md` for the live state and `AGENTS.md` for the short
version of the working rules. This document is the long version: what the product is, how
the pieces talk to each other, where everything lives, how to build and verify each target,
and every trap already paid for once.

## 1. What this is

QuotaVPN (formerly QuotaCards; repo, server hostname and package names still say QuotaCards) is a VPN client for Windows and Android, plus the server tooling behind it. It
exists because the owner's ISP (WE, Egypt, VDSL 35b) sells separate "gaming" and "streaming"
quota buckets, and a normal VPN spends the wrong one. The app shapes its traffic so the
carrier classifies it into the bucket the card is meant to spend.

Two client apps, one server:

- **Windows** (`desktop/`): Tauri 2 app. The UI is React (`desktop/ui-next`). The engine uses
  sing-box + wintun to open a TUN adapter, and it is a FORK (amnezia-box, `engine-awg-1141`)
  because upstream sing-box refuses AmneziaWG. Carries all three transports: Standard VLESS,
  WireGuard (AmneziaWG obfuscated endpoint on UDP 53, which is what makes it work from Egypt)
  and Hysteria2 (UDP 443), provisioned through the server helpers.
- **Android** (`android/tauri-app/`): Tauri 2 app with a Kotlin `VpnService` and a Go tunnel
  library (`libbox.aar`). Same three transports as the desktop.
- **Server**: a small VPS serving Xray/VLESS, WireGuard and Hysteria2, provisioned and
  maintained over SSH by scripts in `embed/`.

The owner is Yousef (GitHub `yousefmohiey`). Public credit for this repository is his alone:
commits, code comments and docs must not carry an assistant or agent name.

## 2. How the quota mechanic works

- The ISP inspects TCP handshakes and reads SNI. Each card pins a domain (`sni`), and the
  client presents that domain in the TLS handshake, so the connection lands in that card's ISP
  bucket. The Gamerz cards use gaming domains, Streamerz cards use streaming domains.
- WireGuard and Hysteria2 are UDP, so the ISP cannot read an SNI. Both spend the **general**
  quota bucket, not the gaming or streaming buckets. Whether Hysteria2 lands in general quota
  the same way is not settled in code; it was inferred empirically and should be re-measured
  on the ISP before anyone claims it in the UI.
- The app keeps a card list in `%APPDATA%/quotacards/config.json`. A card is a UUID plus a
  name, a type (`Gamerz` / `Streamerz`) and an SNI domain. Cards are created, and their
  credentials registered on the server, through the app.

## 3. Runtime flows

**Connect (Windows, Standard).** The UI calls `tunnel_start`. The backend builds a sing-box
config (routing rules plus the per-app policy), spawns the engine, which opens the TUN
adapter. Traffic counters are read from the adapter with `GetIfTable2`. On first connect after
a card was generated or imported, the backend re-registers any card the server does not know;
the server list is the source of truth on `qc-list`.

**Card lifecycle (Windows).** `generate_card`, `import_card` and `revoke_card` save locally
first and answer the UI immediately, then do the SSH work in a detached task. Never make those
commands wait on the network again; the lag was a reported bug.

**Per-app routing.** Mode is `all`, `allow` ("only these") or `block` ("all except these").
Windows resolves the installed-app list in `tunnel_apps` and returns JSON rows
`[{ pkg, label }]`, where `pkg` is the executable name that rules match on. The UI must send
the executable name back, which is why old selections saved as display labels do not match
after an upgrade and the list has to be re-picked once.

**Updates.** Both apps check `https://github.com/YousefMohiey/QuotaCards/releases/latest/download/latest.json`.
The PC downloads the NSIS installer and applies it (signed feed, `TAURI_SIGNING_PRIVATE_KEY`).
The phone downloads the APK and hands it to the system installer. The feed asset must be named
exactly `latest.json`.

Every build carries a stamp (`QC_BUILD` from `build.rs`: the short git hash, or `dev` when git
was not available), and `latest.json` repeats it as a top-level `build` field. The PC compares
the two, so a re-released build that keeps the SAME version number is still offered, once per
new stamp; a feed without a stamp, and any `dev` local build, never gets a same-version offer.
The publish scripts write the field automatically, so nothing is set by hand.
The rerun trigger covers both `.git/HEAD` and `.git/refs/heads`: a commit only advances the
branch ref, so a build script that watched HEAD alone kept the previous commit's `QC_BUILD`.
After any release build, confirm the short hash appears in
`desktop/src-tauri/target/x86_64-pc-windows-gnu/release/QuotaVPN.exe` (raw search; the
`setup.exe` is compressed and shows nothing); touch `desktop/src-tauri/build.rs` to force a
re-read in a dirty tree. A stale stamp makes every install re-offer the same release forever.

**Speed test.** A full run goes through the official Ookla CLI (`src/ookla.rs` fetches it once
into `%APPDATA%/quotacards/bin`; the binary is never bundled). Its progress lines stream live
ticks for the graph; its `Idle Latency` line streams ping+jitter the moment it is measured; each
phase's final value streams the moment that phase ends (`speed-result`). The phase callback
fires ONCE per change, never per progress line (announcing it per line reset the UI's graph ten
times a second and the run looked dead next to the moving number). Single-tile reruns and the
fallback use the built-in measurer (`src/speed.rs`, LibreSpeed-shaped) against the owner's
server (`/speed/down`, `/speed/up`) plus public ping targets.

## 4. Code map

### Core crate (root: `src/`, `Cargo.toml`)

- `src/vpn.rs`: TUN config builder, routing rules, per-app matching, interface naming.
  Windows-only paths are `cfg`'d out on Android.
- `src/server.rs`: server-side provisioning helpers (add/remove a client, WireGuard peer,
  Hysteria2 credentials, version/need-upgrade checks).
- `src/ssh.rs`: the SSH transport used for all provisioning.
- `src/config.rs`: config struct, paths, load/save.
- `src/lib.rs`: shared exports.
- `examples/`: `smoke.rs`, `vpntest.rs`, `embedprobe.rs` are manual probes, not tests.
- The root crate deliberately has no `accesskit` and no `eframe` dependency: both hard-break the
  Android build. Do not add them back.

### Windows app

- `desktop/src-tauri/src/lib.rs`: everything native. Tray, single-instance guard, the updater,
  `tun_octets` traffic reader, and the commands registered with `generate_handler!`:
  `get_state, probe_server, generate_card, import_card, revoke_card, copy_card, tunnel_start,
  tunnel_stop, tunnel_status, tunnel_traffic, tunnel_log, tunnel_copy_log, tunnel_probe,
  tunnel_apps, resolve_host, check_update, apply_update`.
- `desktop/ui-next/`: React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui (Radix) + Motion +
  Lucide. Structure: `src/App.tsx` (hash router, scene, content frame), `src/state/app.tsx`
  (all app state and actions), `src/lib/ipc.ts` (typed command bridge), `src/lib/mock.ts`
  (browser preview stand-in), `src/lib/speedtest.ts`, `src/lib/snis.ts` (domain catalogue),
  `src/lib/i18n/` (EN + AR), `src/components/` (Sidebar, Hero, Dial, SpeedBars, PickerDialog,
  Row, Segmented, ui/*), `src/screens/` (Home, Cards, Speed, Settings, Apps).
- `desktop/ui/`: the old vanilla UI. Kept only as a reference for behaviours the owner liked.
  It is not shipped.
- `desktop/src-tauri/tauri.conf.json`: `frontendDist` points at `../ui-next/dist`.
- Native helpers beside `lib.rs`: `src/ookla.rs` (fetch, run and parse the official CLI, with
  the phase-once emitter and streamed partial results), `src/speed.rs` (built-in measurer),
  `build.rs` (QC_BUILD stamp, admin manifest for bins, plus an asInvoker test manifest) and
  `capabilities/default.json` (event listeners plus `core:window:allow-start-dragging`; a missing
  permission makes the matching webview call silently do nothing).

### Android

- `android/tauri-app/`: the shipping phone app. Rust backend reuses the core crate; the phone
  UI is vanilla HTML/CSS/JS in `android/tauri-app/ui/` (no bundler, not React).
- `android/tauri-plugin-qctunnel/`: the native tunnel plugin. Carries the prebuilt
  `android/libs/libbox.aar` (27 MB). Never delete or regenerate it.
- `android/qc-mobile/`: retired egui shell, kept in tree for reference only.
- `android/ui-design-notes/`: the design notes the phone UI was built from.

### Server and tooling

- `embed/qc-net.sh`: the server provisioning script (Xray, WireGuard, Hysteria2, quotas).
- `embed/qc-fresh.sh`, `embed/qc-agent.sh`: first-boot and maintenance helpers.
- `embed/qc-speed.py` + `qc-speed.service`: the speed endpoints; Xray `settings.fallbacks`
  routes `/speed/*` on 127.0.0.1:8080 to it so measurements travel the real path.
- `embed/quotacards-embed.pem` / `.pub`: the restricted embed key pair. The private key ships
  inside the app on purpose (it is what lets the app talk to the server), the public key is
  installed in the server's `authorized_keys`. It is in the repo deliberately: do not "clean it
  up", rotate it, or treat it as a leak.
- `tools/make-icons.py`: regenerates every icon set from `res/app-icon-src.png` and verifies the
  frames. `tools/build-apk.sh`: the one-command signed APK build. `tools/sync-mobile-assets.sh`:
  copies the phone UI into the Android asset folder.
- Release tooling lives **outside** the repo, in `C:/Tools/qc-tools/` on the owner's build
  machine (publish script, UI audit scripts, screenshot drivers). If you clone this repo
  elsewhere, that tooling will not be there; the release can still be done by hand with `gh`.
- `docs/ARCHITECTURE.md` and `docs/STATUS.md`: older but still accurate summaries; this file is
  the entry point.

## 5. Config and secrets

- App config: `%APPDATA%/quotacards/config.json` on Windows. Holds the server address, port,
  user, the card list, and the SSH private key the app uses. Treat it as a secret file: never
  commit it, never print it, never paste it into an issue or a chat.
- Signing material lives outside the repo on the build machine: the release keystore
  (`C:/Tools/qc-release.keystore` plus its password file), the updater key
  (`C:/Tools/qc-updater.key`, `.pub`, password file), and the APK signing passwords. None of it
  belongs in git, and none of it may appear in logs or transcripts.
- The repo does contain the embed key described above, plus `licenses`/`README` text. That is
  expected.

## 6. Build and verify

All commands run from git-bash on Windows. Toolchain this project was developed against:
MinGW at `C:/Tools/mingw_extract/mingw64/bin`, Android SDK + NDK 28.2.13676358, a JDK 23 for
`JAVA_HOME`, Node 22, `tauri-cli` 2.11.4, NSIS at `C:/Program Files (x86)/NSIS`.

**Desktop UI**

```
cd desktop/ui-next
npm install          # first time only
npm run build        # tsc + vite, must end with "built in ...", zero TS errors
npm run preview      # serves the built UI on http://localhost:4173 for inspection
```

**Desktop app (release)**

```
cd desktop/src-tauri
cargo build --release --offline --target x86_64-pc-windows-gnu
```

`tauri dev` is unusable here: the dev profile fails to link under MinGW (`export ordinal too
large`). Always verify through a release build. To run the exe, copy `WebView2Loader.dll` next
to it.

**Installer (NSIS, signed updater feed)**

```
cd desktop
node ../android/tauri-cli-npm/node_modules/@tauri-apps/cli/tauri.js build \
  --bundles nsis --target x86_64-pc-windows-gnu
```

with `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` exported, and NSIS on
PATH. Produces `bundle/nsis/QuotaVPN_<version>_x64-setup.exe` plus its `.sig`.
Run `npm run build` in `desktop/ui-next` first: `beforeBuildCommand` is empty, so this command
embeds whatever `ui-next/dist` currently holds. The desktop package carries
`[profile.release] strip = true`; without it the bare exe shipped with ~17 MB of symbol table
(48 MB vs about 31 MB, and the installer shrinks with it). Changing the profile forces one full
dependency rebuild.

**Phone**

```
bash tools/build-apk.sh      # syncs assets, builds, signs, verifies; needs ANDROID_HOME
```

Before any native SDK `.exe` call inside that script the path must be run through `cygpath`.

**Icons**

```
python tools/make-icons.py   # ALL_VERIFIED means every frame is correct
```

**Release**

1. Bump the version in **four** places and keep them equal: `desktop/src-tauri/tauri.conf.json`,
   `desktop/src-tauri/Cargo.toml`, `android/tauri-app/src-tauri/tauri.conf.json`,
   `android/tauri-app/src-tauri/Cargo.toml`.
2. Build the installer and the APK.
3. Publish the GitHub release with four assets: the setup exe, its `.sig`, `latest.json`, and
   `QuotaCards-mobile-signed.apk`. Ship both platforms at the same version or the phone will be
   offered a release with no APK. Commit and push the bump before creating the release: the tag
   follows the remote default branch, and the installer's `QC_BUILD` stamp should be the
   published commit.
4. Verify by fetching the exact URL the apps fetch:
   `curl -sL https://github.com/YousefMohiey/QuotaCards/releases/latest/download/latest.json`
   and confirming the version is the new one.

## 7. Design system and UI conventions

The desktop UI is the React app, and its contract is written down in `AGENTS.md`. The parts
that matter most:

- **Tokens, not magic numbers.** `desktop/ui-next/src/index.css` defines one control height
  (36px), one page padding, one card padding, one row rhythm, one radius per role, one shadow
  per material and two transition durations (160ms / 190ms). Surface classes: `.glass` (content
  pane), `.glass-side`, `.glass-dialog`, `.glass-tile`, `.pane`, `.list-sep`, `.nav-item`,
  `.page-head`/`.page-title`/`.page-sub`. A new page composes these; it does not invent numbers.
- **One scroll region.** The `main` element is the only thing that scrolls. There are no nested
  scroll surfaces; a long list just makes the page taller.
- **No dropdown menus.** Choices open the searchable list picker (`components/PickerDialog.tsx`)
  with a check on the current value. This is a standing owner preference.
- **Three text colours only** (near-white primary, muted blue-gray secondary, quieter gray
  tertiary). No neon, no gradients as decoration, no oversized pills.
- **Language.** Every user-visible string goes through `src/lib/i18n/{en,ar}.ts`. Arabic is
  formal Modern Standard Arabic, and Arabic changes text direction and alignment but must
  **never** mirror the layout.
- **Never emit em-dashes** anywhere: code, UI strings, docs, commit messages. Use plain hyphens.
  The owner reads them as a tell.
- **Icons**: `tools/make-icons.py` trims the master to its content box (a bare `getbbox()` is
  defeated by an alpha haze in the art), keeps a 2% margin, sharpens hardest at 16 to 48px, and
  verifies each frame. The tray uses the 32px frame. A shortcut keeps the old look until the
  exe changes and Windows' icon cache refreshes.
- **Glass trap**: never declare `backdrop-filter` and `-webkit-backdrop-filter` together. Vite's
  minifier (lightningcss) keeps only the `-webkit-` form, Chromium ignores it, and the blur
  silently disappears from the shipped build.

## 8. Verifying UI work (the honest way)

- Serve the built UI (`npm run preview`, port 4173) and drive it over CDP. Two traps cost real
  time: the harness throttles timers in pages it considers background (enable
  `Emulation.setFocusEmulationEnabled` before timing anything, otherwise a 9 second measurement
  takes 80 seconds and looks like a hang), and the animation clock can be frozen (measure
  geometry with `getBoundingClientRect` instead of trusting a screenshot).
- Vision models mis-measure layouts. Verify numbers in the DOM.
- For the packaged app, remember `WebView2Loader.dll` must sit beside the exe, and there is no
  usable `tauri dev`.
- The phone app can only be truly tested on a phone; the emulator does not have the ISP.

## 9. Known issues, traps and open questions

- A force-killed run can leave a ghost TUN adapter with the same name whose counters always read
  zero. `tun_octets` takes the **busiest** matching adapter and recognises wintun descriptions;
  keep that behaviour.
- There is **no kill switch** in the engine. The UI does not advertise one, and should not until
  a real firewall implementation exists.
- Hysteria2 quota attribution is unsettled (see section 2). Plain WireGuard from WE fixed
  lines is DPI-blocked (the ISP drops its handshake packets in transit), which is why the
  desktop's WireGuard is AmneziaWG on the forked amnezia-box engine: obfuscated handshakes pass
  and carry real traffic from Egypt, verified end to end. Plain-WG clients (old builds, stock
  libbox on the phone, third-party apps) can no longer handshake against the server; that is
  expected. Hysteria2 remains the other Egypt-proof UDP transport.
- Test targets in `desktop/src-tauri` that reference the lib cannot load on this build box
  (0xc0000139: they import WebView2Loader and comctl32 v6, and no manifest or DLL copy fixes
  it). Only a target that links nothing runs. Put executable checks in a bin instead:
  `clitest --selftest` covers the speed parser, and root-crate tests stay the unit lane.
- The phone APK is sideloaded over LAN; keep it small.
- The owner installs builds on another machine, so anything you build here must be a complete
  artifact (exe plus DLL, or installer, or signed APK), not just a build tree.
- Never publish or share a build until the owner explicitly asks for it.

## 10. Environment (this build machine)

- Repo: `C:/Tools/QuotaCards`, branch `master`, remote `YousefMohiey/QuotaCards`.
- Scratch: `C:/Tools/qc-tools` (release and audit scripts), `C:/Tools/shots-react` (UI
  screenshots).
- Python with Pillow and pefile lives in the Hermes venv under
  `C:/Users/Administrator/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe`.
- `gh` CLI at `C:/Program Files/GitHub CLI/gh.exe` is authenticated for the owner's account.

## 11. Current state (as of this handoff)

- Latest release: **v0.3.2** (installer, APK, feed), published and live.
- v0.3.2 carries the installer shortcut cleanup: exactly one desktop shortcut, named QuotaVPN,
  with the legacy QuotaCards and Quota names removed from the user and shared desktops and both
  start menus on every install and in-app update, and the finish page no longer offering its
  own create-desktop-shortcut checkbox. The checkbox defines are stripped from the generated
  NSIS script by `C:/Tools/qc-tools/qc-nsi-patch-sign.py`, which re-runs makensis and re-signs;
  the release build script (see `C:/Tools/qc-tools/build-032.sh`) calls it after the bundler
  build. The app itself is unchanged from 0.3.1: the AmneziaWG WireGuard transport (obfuscated,
  Egypt-proof, with a self-healing cached parameter fetch), the disconnect fix (a live engine is
  never dropped from the app's state, and a slow-rising connect still lands in a disconnectable
  state), live speed-test updates, drag from any empty spot inside the window, the refresh
  control on the Speed page, and the smaller stripped binary.
- The desktop UI runs the React app; the phone still runs its vanilla UI, and its WireGuard is
  dead against the AWG server (rebuilding libbox from the fork is the fix if that ever matters).
- Next release shape when asked: bump the four version files, `npm run build` in `ui-next`,
  build installer plus APK (the NSIS build script includes the checkbox patch + re-sign step),
  write `C:/Tools/qc-relnotes-<vvv>.md`, then `python C:/Tools/qc-tools/publish.py <ver>` and
  verify the live feed. publish.py takes the feed's build stamp from the shipped app exe (the
  exact value the app compares against), so a commit landing after the build cannot strand
  users on a same-version update loop.
