# QuotaCards

Personal Android VPN app + Rust core. One-click server setup, shareable
VLESS cards, and three in-app transports. Built for ISPs that bill by
quota buckets (gaming / streaming / general) decided from the TLS
handshake.

Cards are plain `vless://` links: they also work in NekoBox, v2rayNG,
and anything else that speaks VLESS.

## Quota behavior (verified live, Sept 2026, WE Egypt)

| Mode      | Transport              | Counts from |
|-----------|------------------------|-------------|
| Standard  | VLESS TCP:443, SNI stamp, randomized handshake | Your package (gamerz/streamerz) |
| Game      | Hysteria2 UDP:443, same SNI | General quota (ISP reads SNI off TCP only) |
| WireGuard | Raw UDP, no handshake stamp | General quota |

So: Standard for quota, Game/WireGuard for raw speed. The app labels
say exactly this; see `docs/STATUS.md` for what works and what does not.

## How the stamp works

Every Standard/Game connection carries a TLS SNI from the package
whitelist (Gamerz: EA, Epic, Riot, CoD, PUBG, Steam... / Streamerz:
YouTube, Meta, X, Prime, Shahid, OSN+...). Same parameters as the
well-known seller links (`fp=random`, `alpn=h3,h2,http/1.1`,
`allowInsecure=1`), verified byte-equivalent against NekoBox behavior.

## Server setup

You bring Ubuntu 22.04+ ARM/x64 with passwordless sudo (Oracle Always
Free works). Two scripts in `embed/`:

1. `qc-fresh.sh` - Xray (VLESS TCP/443) + restricted `qc-agent` key.
   Needs the app's embedded public key baked in before upload.
2. `qc-net.sh` - Hysteria2 (UDP/443) + WireGuard (UDP/51820, plus a
   UDP/53 redirect for ISPs that filter the default port) + helpers.

Open these on the instance subnet's security list (the list attached to
*that* subnet, not an old one):

| Direction | Protocol | Port | Used by |
|-----------|----------|------|---------|
| In | TCP | 22 | setup SSH |
| In | TCP | 443 | Standard |
| In | UDP | 443 | Game |
| In | UDP | 51820 | WireGuard |
| In | UDP | 53 | WireGuard alt |

Point a DuckDNS (or any) name at the box and refresh it on a cron;
the app resolves it on every connect. SSH stays key-only; the app's
day-to-day key is forced to `qc-agent` (add/revoke/list clients only,
no shell).

## App

- `android/tauri-app/ui/` - the whole UI (HTML/CSS/JS, EN + AR).
- `android/tauri-app/src-tauri/` - Rust bridge: card/server state,
  per-transport sing-box config builder, SSH provisioning calls.
- `android/tauri-plugin-qctunnel/` - Kotlin `VpnService`, libbox
  (sing-box 1.14) engine, quick-settings tile, per-app picker.
- `src/` - Rust core shared by desktop (`main.rs`, Windows egui +
  wintun) and mobile.

Build needs Android SDK 35, NDK 28, JDK 23, Rust stable, Node. The
long command lives in project history; the reliable path is
`tauri android build -t aarch64 --apk`, then `zipalign` + `apksigner`.
Debug keystore is local-only, never committed.

`embed/*.pem` (device private key) is gitignored. No tokens or
passwords live in this repo; the DuckDNS token lives only in the
server crontab.

## Docs

- `docs/ARCHITECTURE.md` - how it is built, file by file.
- `docs/STATUS.md` - what works, known issues, roadmap.
