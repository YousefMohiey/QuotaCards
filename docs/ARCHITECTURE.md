# Architecture

## Pieces

```
phone UI (ui/index.html + app.js + style.css)
  |  Tauri invoke (tunnel_*, resolve_host, card/server commands)
  v
src-tauri/src/lib.rs ......... app state, card store, config builder
  |  quotacards crate (src/): config / server / ssh
  |    SSH: full key (setup) or embedded key -> qc-agent (daily use)
  v
server scripts (embed/) ...... Xray + sing-box Hy2 + WireGuard + NAT
  =
tunnel path: UI -> TunnelPlugin (Kotlin) -> TunnelService (VpnService)
  -> libbox.aar (sing-box 1.14) -> TUN (gvisor, auto-route, strict)
```

Desktop (`desktop/`, Tauri) reuses the same crate and drives its own TUN
via pinned sing-box + wintun (`src/vpn.rs`). Its tunnel addresses are picked
per connect, first free candidate of 172.19.0.1 / 172.20.0.1 / 172.21.0.1 /
172.22.0.1 / 10.18.0.1 / 10.19.0.1 / 10.20.0.1 / 10.21.0.1 plus a matching
IPv6 ULA list (fdfe:dcba:9876::1 up to ::987b::1): a hardcoded address
collides with ghost adapters and with Hyper-V / Docker / WSL on some PCs,
and the engine then dies with "set ipv4 address" or "set ipv6 address: The
object already exists". The picks are written to `tun-ip.txt` and
`tun-ip6.txt` beside the config so route checks and cleanup follow them.

## Config builder (`android_tun_config`, src-tauri lib.rs)

One sing-box config per transport, same shell every time:

- TUN `172.19.0.1/30`, mtu 9000, gvisor, auto+strict route.
- Server IP resolved fresh per connect; the literal IP is dialed while
  TLS keeps the card SNI. Server IP + public DNS are route-excluded so
  the engine can still dial out.
- DNS: DoH `1.1.1.1` through the tunnel (final), plain `8.8.8.8`
  direct as resolver/bootstrap.
- Route: sniff, kill LAN multicast noise, hijack DNS, final `proxy`.

Transport differences:

- **vless**: VLESS+TLS, `server_name` = card SNI, `insecure` (self-signed
  server cert), ALPN h3/h2/http1.1, **uTLS fingerprint `random`**.
  Learned the hard way: Chrome-spoof and native stacks get classified
  as proxy tooling; randomized handshakes fall back to SNI, which is
  what the quota needs. Mirrors NekoBox's handling of `fp=random`.
- **hy2**: Hysteria2 outbound, same SNI, password fetched once over SSH
  and cached. No fingerprint concept (QUIC).
- **wg**: sing-box 1.13 **removed the wireguard outbound**, so this is a
  `wireguard` **endpoint** tagged `proxy` (official migration): client
  address + private key provisioned per card over SSH, peer = server:53
  (port 53 dodges ISP filtering of 51820; server REDIRECTs 53->51820),
  `allowed_ips 0.0.0.0/0`, keepalive 25s for mobile NAT. Route/DNS keep
  pointing at the `proxy` tag untouched.

"Connected" in the UI means engine + TUN are up, **not** that a
handshake completed (same gap official clients close with handshake
state; still open here).

## Server side

- `embed/qc-fresh.sh`: Xray install + self-signed cert (CN=ea.com) +
  `qc-agent` forced command for the embedded key.
- `embed/qc-net.sh`: sing-box Hy2 (users-array auth, NOT legacy
  top-level `password` - that field is rejected), WireGuard interface +
  per-card peers registry, NAT masquerade, UDP/53 redirect.
- `qc-agent`: day-to-day key can only `qc-add/qc-revoke` (+ `qc-list`,
  `qc-hy2-pass`, `qc-wg-*` on the live box - repo script lags behind,
  see STATUS).
- iptables order matters: wg ACCEPTs must be INSERTED above the
  distro's default FORWARD REJECT (`-I`, never `-A`), or handshakes
  complete with zero traffic.
- Oracle Cloud: UDP rules must sit on the *instance's own* subnet list.
  Verified by sending probe packets and watching server counters.

## Key files

| Path | Role |
|------|------|
| `android/tauri-app/ui/app.js` | all UI logic + EN/AR strings |
| `android/tauri-app/ui/style.css` | glass UI, tab scroll container, centered picker |
| `android/tauri-app/src-tauri/src/lib.rs` | commands + per-transport config builder |
| `src/server.rs` | SSH provisioning (Xray/Hy2/WG client mgmt) |
| `src/config.rs` / `src/ssh.rs` | card store + keys / SSH transport |
| `android/tauri-plugin-qctunnel/.../TunnelService.kt` | VpnService, uplink monitor, per-app rules, tile |
| `android/tauri-plugin-qctunnel/android/libs/libbox.aar` | pinned engine (sing-box 1.14-class; config schema must match it) |
| `embed/qc-fresh.sh`, `embed/qc-net.sh` | server bootstrap + network modes |
