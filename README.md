![QuotaCards banner](assets/banner.svg?v=4)

[![Latest release](https://img.shields.io/github/v/release/YousefMohiey/QuotaCards)](https://github.com/YousefMohiey/QuotaCards/releases/latest)
![Windows](https://img.shields.io/badge/Windows-0078D4?logo=windows&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?logo=android&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

QuotaCards is a personal VPN built for ISPs that bill by quota buckets (gaming / streaming / general) decided from the TLS handshake. One Windows PC app plus one Android app, both driven by shareable VLESS cards. English and Arabic UI.

## Download

Grab the latest build from [Releases](https://github.com/YousefMohiey/QuotaCards/releases/latest):

- **Windows**: `quotacards-win.zip`. Unzip both files into one folder and run. The app checks for updates by itself under Settings, Updates.
- **Android**: `QuotaCards-mobile-signed.apk`. Sideload and install.

Cards are plain `vless://` links, so they also work in NekoBox, v2rayNG, and anything else that speaks VLESS.

## How quota routing works

Every Standard/Game connection carries a TLS SNI from the package whitelist (Gamerz: EA, Epic, Riot, CoD, PUBG, Steam... / Streamerz: YouTube, Meta, X, Prime, Shahid, OSN+...). Same parameters as the well-known seller links (`fp=random`, `alpn=h3,h2,http/1.1`, `allowInsecure=1`).

| Mode | Transport | Counts from |
|------|-----------|-------------|
| Standard | VLESS TCP:443, SNI stamp, randomized handshake | Your package (gamerz/streamerz) |
| Game | Hysteria2 UDP:443, same SNI | General quota (ISP reads SNI off TCP only) |
| WireGuard | Raw UDP, no handshake stamp | General quota |

So: Standard for quota, Game/WireGuard for raw speed. Verified live against WE Egypt, Sept 2026.

## Windows app

Native desktop layout with sidebar, same dark glass theme as the phone:

- One-tap connect with live session time and up/down counters
- Cards manager with centered dialogs, per-app routing picker
- Speed screen: ping (Google, card domain, Quad9, 1.1.1.1) plus download/upload throughput against your own server
- Kill switch on by nature: strict routing, no leak path
- Self-updater: Settings, Updates, Download update installs the new build and restarts, no installer

## Android app

- Whole-device tunnel (VpnService + sing-box engine), quick-settings tile
- Per-app routing, Always-on compatible, swipe-away safe
- Same cards, same quota logic, Arabic RTL

## Server setup

You bring Ubuntu 22.04+ ARM/x64 with passwordless sudo (Oracle Always Free works). Two scripts in `embed/`:

1. `qc-fresh.sh` - Xray (VLESS TCP/443) plus a restricted `qc-agent` key. Needs the app's embedded public key baked in before upload.
2. `qc-net.sh` - Hysteria2 (UDP/443) plus WireGuard (UDP/51820, with a UDP/53 redirect for ISPs that filter the default port) plus helpers.

Open these on the instance subnet's security list (the list attached to *that* subnet, not an old one):

| Direction | Protocol | Port | Used by |
|-----------|----------|------|---------|
| In | TCP | 22 | setup SSH |
| In | TCP | 443 | Standard |
| In | UDP | 443 | Game |
| In | UDP | 51820 | WireGuard |
| In | UDP | 53 | WireGuard alt |

Point a DuckDNS (or any) name at the box and refresh it on a cron; the app resolves it on every connect. SSH stays key-only; the day-to-day key is forced to `qc-agent` (add/revoke/list clients only, no shell).

## Project layout

- `desktop/ui/` - Windows UI (HTML/CSS/JS, EN + AR)
- `desktop/src-tauri/` - Windows backend: whole-PC sing-box + wintun engine, live process list, updater
- `android/tauri-app/ui/` - phone UI (HTML/CSS/JS, EN + AR)
- `android/tauri-app/src-tauri/` - Rust bridge: card/server state, per-transport config builder
- `android/tauri-plugin-qctunnel/` - Kotlin `VpnService`, libbox engine, tile, per-app picker
- `src/` - Rust core shared by both apps
- `embed/` - server scripts plus the local-only device key (`*.pem` is gitignored, never committed)

Build needs Rust stable, Node, plus Android SDK 35 / NDK 28 / JDK 23 for the APK. Release builds are `cargo build --release` (PC) and `tauri android build --apk` with `zipalign` + `apksigner` (phone). No tokens or passwords live in this repo; the DuckDNS token lives only in the server crontab.

## Docs

- `docs/ARCHITECTURE.md` - how it is built, file by file
- `docs/STATUS.md` - what works, known issues, roadmap
