# Status (Sept 2026)

Maintained state of record: `docs/HANDOFF.md` (v0.3.2, Sept 21 2026). This page is a
historical snapshot; where it disagrees with HANDOFF.md, HANDOFF.md wins.

## Works

- Standard mode connects; traffic counts from gamerz/streamerz quota
  (randomized handshake + SNI stamp, verified by packet capture: SNI on
  the wire, WE app bucket moves).
- Game (Hysteria2) connects with working traffic; the PC's WireGuard is
  AmneziaWG (obfuscated) since WE's DPI drops plain handshakes - it connects
  and carries traffic from Egypt. Both count from general quota (ISP reads
  SNI off TCP only). The phone's WireGuard cannot speak AWG yet (stock
  libbox).
- Cards generate / copy / revoke; same `vless://` links import into
  NekoBox/v2rayNG and count correctly there.
- Cards self-heal: connect re-registers any local card missing on the
  server (`qc-list` + idempotent add).
- Per-app VPN (all / only-these / all-but-these), quick-settings tile,
  kill-switch path via system Always-on VPN (+ Block connections).
- Speed test runs the official Ookla CLI on full runs (live graph, results
  as they are measured), with the built-in measurer for single tiles and
  fallback.
- Windows ships as an NSIS installer; closing the window hides to the
  tray (Show / Check for updates / Quit), and updates install from
  GitHub by themselves (signed feed, auto-restart).
- PC app redesigned as a native Windows app (Fluent spacing, Segoe UI
  Variable, connection card with live traffic, Settings-style rows),
  same theme as the phone.
- Per-app routing on PC: all / only-these / all-except, matched by
  process in the engine; config shapes locked by cargo tests.
- Motion: the connection dial sits centred and slides left the moment
  Connect is pressed, with the status/traffic panel revealing alongside
  it. Motion survives the OS "animation effects off" setting (that
  setting only stands down the endless decorative pulses).
- Phone app has its own update check (Settings, Updates): checks
  GitHub, downloads the APK, opens the system installer for one
  confirm tap. Same version number as the PC build.
- Look and feel keyed to the app icon on both platforms: near-black
  navy surfaces, royal blue accent, off-white text, muted semantics
  (no neon anywhere). Desktop hero choreography: the dial starts
  centred and slides left on connect while the status, profile, live
  traffic and Session/IP/Server tiles reveal in sequence. Cards are
  uniform, one colour, kind shown as a badge. Audited against the Web
  Interface Guidelines (labels, aria-live, skip link, focus rings,
  contrast, overscroll, list performance).
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
