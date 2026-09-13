# Status (Sept 2026)

## Works

- Standard mode connects; traffic counts from gamerz/streamerz quota
  (randomized handshake + SNI stamp, verified by packet capture: SNI on
  the wire, WE app bucket moves).
- Game (Hysteria2) and WireGuard (endpoint, UDP/53) connect with working
  traffic; both count from general quota (ISP reads SNI off TCP only).
- Cards generate / copy / revoke; same `vless://` links import into
  NekoBox/v2rayNG and count correctly there.
- Cards self-heal: connect re-registers any local card missing on the
  server (`qc-list` + idempotent add).
- Per-app VPN (all / only-these / all-but-these), quick-settings tile,
  kill-switch path via system Always-on VPN (+ Block connections).
- In-app speed test (Cloudflare endpoints, measures the live path).
- Server page in 4 sections (Status/Connection/General/Protection),
  centered pickers, no content trapped behind the tab bar, EN + AR RTL.
- Honest labels: Game/WireGuard warn they count general.
- Server: Xray + Hy2 + WG all live; DuckDNS self-updates every 5 min;
  firewall rule order fixed; setup scripts persist it.

## Known issues

- `embed/qc-agent.sh` in repo is older than the live box (live also
  serves `qc-list`, `qc-hy2-pass`, `qc-wg-pub/add/del`). Reconcile
  before a fresh-server rebuild from this repo alone.
- "Connected" = TUN up, not handshake-verified. A dead UDP path still
  shows Connected with no traffic.
- Upload hosts rot: litterbox currently WAF-blocks APK uploads, uguu
  rejects `.apk`, bashupload/gofile unreachable from here; tmpfiles.org
  works but expires fast. Revisit per release.
- `libbox.aar` is a pinned binary: sing-box schema moves under it
  (1.13 killed the wireguard outbound). Any engine bump = re-validate
  all three configs with `sing-box check` first.
- WE filters UDP/51820 on some lines (hence the UDP/53 door). New
  networks may need the same treatment.

## Roadmap (proposed)

- [ ] Handshake-aware status (confirm WG/Hy2 session before "Connected").
- [ ] Reconcile `qc-agent.sh` v2 into repo; single-script fresh rebuild.
- [ ] DNS-split experiment: direct DNS for the SNI domain only, test if
  quota classification changes.
- [ ] TCP-based low-latency mode (if Game must ever count quota).
- [ ] Stable release hosting for APKs (own server URL or GitHub Releases).
- [ ] Version display in-app (tell builds apart on-device).
- [ ] iOS / desktop-mobile parity: out of scope until Android is bored.
