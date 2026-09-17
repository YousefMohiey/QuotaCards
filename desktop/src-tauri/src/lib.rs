//! QuotaCards desktop backend (Tauri + WebView).
//!
//! Same UI and server core as the phone app. The tunnel here is the
//! built-in sing-box + wintun engine (whole-PC TUN), driven by the
//! shared `quotacards::vpn` module - no plugin, no mobile service.
//! Config lives in the OS config dir, so cards carry over from the
//! previous desktop app untouched.

use quotacards::{
    config::{AppConfig, Card, EMBED_KEY, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_USER},
    server, vpn,
};
use std::sync::Mutex;
use tauri::Manager;
use tauri::Emitter;
use tauri::WindowEvent;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_updater::UpdaterExt;

pub mod speed;
pub mod ookla;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct State(Mutex<AppConfig>);
/// Live engine PID. None means no tunnel (or one we no longer track).
struct Engine(Mutex<Option<u32>>);

#[derive(serde::Serialize)]
struct CmdResult {
    ok: bool,
    msg: String,
}

#[derive(serde::Serialize)]
struct UiState {
    server_ip: String,
    ssh_user: String,
    ssh_port: u16,
    cards: Vec<Card>,
    version: String,
}

fn snapshot(cfg: &AppConfig) -> UiState {
    UiState {
        server_ip: cfg.server_ip.clone(),
        ssh_user: cfg.ssh_user.clone(),
        ssh_port: cfg.ssh_port,
        cards: cfg.cards.clone(),
        version: String::new(),
    }
}

fn build_link(uuid: &str, host: &str, sni: &str, name: &str) -> String {
    format!("vless://{uuid}@{host}:443?type=tcp&encryption=none&security=tls&fp=random&alpn=h3%2Ch2%2Chttp%2F1.1&allowInsecure=1&sni={sni}#{name}")
}

fn gen_keypair() -> Result<(String, String), String> {
    use ssh_key::{Algorithm, LineEnding, PrivateKey};
    let mut rng = rand_core::OsRng;
    let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).map_err(|e| e.to_string())?;
    let pem: String = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();
    Ok((pem, key.public_key().to_string()))
}

fn initial_config() -> AppConfig {
    let mut cfg = AppConfig::load();
    if cfg.private_key.is_empty() {
        if let Ok((priv_pem, pub_line)) = gen_keypair() {
            cfg.private_key = priv_pem;
            cfg.public_key = pub_line;
            cfg.save();
        }
    }
    // Zero-setup: baked-in builds point at the owner's server, nothing to type.
    if let Some(emb) = EMBED_KEY {
        let points_at_mine = cfg.server_ip.is_empty() || cfg.server_ip == DEFAULT_HOST;
        if points_at_mine && cfg.private_key != emb {
            cfg.server_ip = DEFAULT_HOST.to_string();
            cfg.ssh_user = DEFAULT_USER.to_string();
            cfg.ssh_port = DEFAULT_PORT;
            cfg.private_key = emb.to_string();
            cfg.synced = false;
            cfg.save();
        }
    }
    // migrate old cards (no per-card SNI) to a sane default
    let mut dirty = false;
    for c in &mut cfg.cards {
        if c.sni.is_empty() {
            c.sni = "ea.com".to_string();
            dirty = true;
        }
    }
    if dirty {
        cfg.save();
    }
    cfg
}

#[tauri::command]
fn get_state(app: tauri::AppHandle, state: tauri::State<State>) -> UiState {
    let mut st = snapshot(&state.0.lock().unwrap());
    // The running build's own version: the sidebar shows it without waiting
    // for a network round trip to GitHub.
    st.version = app.package_info().version.to_string();
    st
}

#[tauri::command]
async fn probe_server(state: tauri::State<'_, State>) -> Result<CmdResult, String> {
    // Zero-setup: the server is built in, nothing to type. Same probe the
    // phone app runs on open (add + revoke a throwaway client).
    let (host, user, port, key) = {
        let cfg = state.0.lock().unwrap();
        if cfg.server_ip.is_empty() {
            return Ok(CmdResult { ok: false, msg: "No server set up.".into() });
        }
        (cfg.server_ip.clone(), cfg.ssh_user.clone(), cfg.ssh_port, cfg.private_key.clone())
    };
    if !server::is_embed_key(&key) {
        if let Err(e) = server::ensure_xray(&host, port, &user, &key).await {
            return Ok(CmdResult { ok: false, msg: format!("Connect failed: {e}") });
        }
    }
    let probe = uuid::Uuid::new_v4().to_string();
    if let Err(e) = server::add_client(&host, port, &user, &key, &probe).await {
        return Ok(CmdResult { ok: false, msg: format!("Connect failed: {e}") });
    }
    if let Err(e) = server::remove_client(&host, port, &user, &key, &probe).await {
        return Ok(CmdResult { ok: false, msg: format!("Connect failed: {e}") });
    }
    // Server moves/rebuilds wipe registrations: re-add any local card the
    // server does not know (add is idempotent, unknown agents just skip).
    if let Ok(remote) = server::list_clients(&host, port, &user, &key).await {
        let missing: Vec<String> = {
            let cfg = state.0.lock().unwrap();
            cfg.cards
                .iter()
                .map(|c| c.uuid.clone())
                .filter(|u| !remote.contains(u))
                .collect()
        };
        for u in missing {
            let _ = server::add_client(&host, port, &user, &key, &u).await;
        }
    }
    Ok(CmdResult { ok: true, msg: "Connected - server ready.".into() })
}

/// One refresh per app build: list the server's clients and re-add every local
/// card it does not know. Silent, detached, and the marker is only written on
/// success, so a launch with no network simply retries on the next one.
fn spawn_launch_refresh(app: tauri::AppHandle) {
    let version = app.package_info().version.to_string();
    let (host, user, port, key, cards) = {
        let state = app.state::<State>();
        let cfg = state.0.lock().unwrap();
        if cfg.server_ip.is_empty() || cfg.cards.is_empty() || cfg.healed_version == version {
            return;
        }
        (
            cfg.server_ip.clone(),
            cfg.ssh_user.clone(),
            cfg.ssh_port,
            cfg.private_key.clone(),
            cfg.cards.iter().map(|c| c.uuid.clone()).collect::<Vec<_>>(),
        )
    };
    tauri::async_runtime::spawn(async move {
        if let Ok(remote) = server::list_clients(&host, port, &user, &key).await {
            for u in cards.iter().filter(|u| !remote.contains(u)) {
                let _ = server::add_client(&host, port, &user, &key, u).await;
            }
            let state = app.state::<State>();
            state.0.lock().unwrap().healed_version = version;
            state.0.lock().unwrap().save();
        }
    });
}

#[tauri::command]
async fn generate_card(
    _app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    name: String,
    kind: String,
    sni: String,
) -> Result<CmdResult, String> {
    let (host, user, port, key) = {
        let cfg = state.0.lock().unwrap();
        if cfg.server_ip.is_empty() {
            return Ok(CmdResult { ok: false, msg: "Set up your server first.".into() });
        }
        (cfg.server_ip.clone(), cfg.ssh_user.clone(), cfg.ssh_port, cfg.private_key.clone())
    };
    let uuid = uuid::Uuid::new_v4().to_string();
    let sni = if sni.trim().is_empty() {
        (if kind == "Gamerz" { "ea.com" } else { "youtube.com" }).to_string()
    } else {
        sni.trim().to_string()
    };
    let card = Card {
        name: if name.trim().is_empty() { kind.clone() } else { name.trim().to_string() },
        uuid: uuid.clone(),
        card_type: kind,
        sni: sni.clone(),
        wg_private: String::new(),
        wg_addr: String::new(),
    };
    {
        let mut cfg = state.0.lock().unwrap();
        cfg.cards.push(card);
        cfg.save();
    }
    // Registering on the server is an SSH round trip: run it detached so the
    // card shows up at once. Connect re-adds any card the server is missing.
    if !host.is_empty() {
        let (h, u, k) = (host.clone(), user.clone(), key.clone());
        let id = uuid.clone();
        tauri::async_runtime::spawn(async move {
            let _ = server::add_client(&h, port, &u, &k, &id).await;
        });
    }
    Ok(CmdResult { ok: true, msg: "Card created.".into() })
}

#[tauri::command]
async fn import_card(
    state: tauri::State<'_, State>,
    uuid: String,
    name: String,
    kind: String,
    sni: String,
) -> Result<CmdResult, String> {
    let uuid = uuid.trim().to_string();
    if uuid.is_empty() {
        return Ok(CmdResult { ok: false, msg: "That card link has no id.".into() });
    }
    let sni = if sni.trim().is_empty() {
        (if kind == "Gamerz" { "ea.com" } else { "youtube.com" }).to_string()
    } else {
        sni.trim().to_string()
    };
    let name = if name.trim().is_empty() { "Card".to_string() } else { name.trim().to_string() };
    {
        let mut cfg = state.0.lock().unwrap();
        if let Some(c) = cfg.cards.iter_mut().find(|c| c.uuid == uuid) {
            // Same card arriving from another device: refresh it, never duplicate.
            c.name = name;
            c.card_type = kind;
            c.sni = sni;
            cfg.save();
            return Ok(CmdResult { ok: true, msg: "Card updated.".into() });
        }
        cfg.cards.push(Card {
            name,
            uuid: uuid.clone(),
            card_type: kind,
            sni,
            wg_private: String::new(),
            wg_addr: String::new(),
        });
        cfg.save();
    }
    // Best effort: the server may already know this client, and add is
    // idempotent. Detached so adding a card never waits on SSH.
    let (host, user, port, key) = {
        let cfg = state.0.lock().unwrap();
        (cfg.server_ip.clone(), cfg.ssh_user.clone(), cfg.ssh_port, cfg.private_key.clone())
    };
    if !host.is_empty() {
        let (h, u, k) = (host.clone(), user.clone(), key.clone());
        let id = uuid.clone();
        tauri::async_runtime::spawn(async move {
            let _ = server::add_client(&h, port, &u, &k, &id).await;
        });
    }
    Ok(CmdResult { ok: true, msg: "Card added.".into() })
}

#[tauri::command]
async fn revoke_card(state: tauri::State<'_, State>, uuid: String) -> Result<CmdResult, String> {
    let (host, user, port, key) = {
        let mut cfg = state.0.lock().unwrap();
        cfg.cards.retain(|c| c.uuid != uuid);
        cfg.save();
        (cfg.server_ip.clone(), cfg.ssh_user.clone(), cfg.ssh_port, cfg.private_key.clone())
    };
    // The server side is an SSH round trip: run it detached so the list reacts
    // at once. WireGuard peers are per-card, so that peer goes too.
    let (h, u, k) = (host.clone(), user.clone(), key.clone());
    let id = uuid.clone();
    tauri::async_runtime::spawn(async move {
        let _ = server::wg_del(&h, port, &u, &k, &id).await;
        let _ = server::remove_client(&h, port, &u, &k, &id).await;
    });
    Ok(CmdResult { ok: true, msg: "Card revoked.".into() })
}

#[tauri::command]
async fn copy_card(state: tauri::State<'_, State>, app: tauri::AppHandle, uuid: String) -> Result<CmdResult, String> {
    let cfg = state.0.lock().unwrap();
    match cfg.cards.iter().find(|c| c.uuid == uuid) {
        Some(c) => {
            let _ = app.clipboard().write_text(build_link(&c.uuid, &cfg.server_ip, &c.sni, &c.name));
            Ok(CmdResult { ok: true, msg: "Link copied.".into() })
        }
        None => Ok(CmdResult { ok: false, msg: "Card not found.".into() }),
    }
}

#[derive(serde::Serialize)]
struct TunnelState {
    running: bool,
    error: String,
}

#[derive(serde::Serialize)]
struct TrafficState {
    rx: u64,
    tx: u64,
}

fn pid_alive(pid: u32) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .creation_flags(0x08000000)
        .output()
        .map(|o| {
            let t = String::from_utf8_lossy(&o.stdout).to_lowercase();
            t.contains("sing-box") && t.contains(&pid.to_string())
        })
        .unwrap_or(false)
}

fn stop_engine(engine: &tauri::State<Engine>) {
    let pid = engine.0.lock().unwrap().take();
    if let Some(p) = pid {
        vpn::request_graceful_stop(p);
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
    vpn::engine_cleanup_keep(None);
}

fn read_log_tail(n: usize) -> String {
    let txt = std::fs::read_to_string(vpn::engine_log_path()).unwrap_or_default();
    let lines: Vec<&str> = txt.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

#[tauri::command]
async fn tunnel_start(
    app: tauri::AppHandle,
    _state: tauri::State<'_, State>,
    engine: tauri::State<'_, Engine>,
    uuid: String,
    apps_mode: Option<String>,
    apps: Option<Vec<String>>,
    transport: Option<String>,
    voice: Option<bool>,
) -> Result<CmdResult, String> {
    let (host, card) = {
        let state = app.state::<State>();
        let cfg = state.0.lock().unwrap();
        let Some(card) = cfg.cards.iter().find(|c| c.uuid == uuid).cloned() else {
            return Ok(CmdResult { ok: false, msg: "Card not found.".into() });
        };
        (cfg.server_ip.clone(), card)
    };
    if host.is_empty() {
        return Ok(CmdResult { ok: false, msg: "Set up your server first.".into() });
    }
    // Desktop engine is Standard (VLESS) only; Game/WireGuard live on phones.
    match transport.as_deref().unwrap_or("vless") {
        "vless" | "" => {}
        _ => return Ok(CmdResult { ok: false, msg: "Game and WireGuard are phone-only - Standard carries the traffic.".into() }),
    }
    if !vpn::is_elevated() {
        return Ok(CmdResult { ok: false, msg: "Run QuotaCards as administrator, then connect.".into() });
    }
    let voice_on = voice.unwrap_or(false);
    // Voice mode is fixed: only the Riot processes are captured, and inside
    // the engine only their voice channels ride the tunnel.
    let (mode, list) = if voice_on {
        (
            "allow".to_string(),
            vec![
                "VALORANT-Win64-Shipping.exe".to_string(),
                "VALORANT.exe".to_string(),
                "RiotClientServices.exe".to_string(),
            ],
        )
    } else {
        (apps_mode.unwrap_or_default(), apps.unwrap_or_default())
    };
    vpn::ensure_engine().map_err(|e| e)?;
    vpn::write_tun_config(&card.uuid, &host, &card.sni, &mode, &list, voice_on).map_err(|e| e)?;
    vpn::check_config().map_err(|e| e)?;
    stop_engine(&engine);
    let mode_label = if voice_on {
        "voice"
    } else if mode == "allow" && !list.is_empty() {
        "apps"
    } else if mode == "block" && !list.is_empty() {
        "except"
    } else {
        "all"
    };
    vpn::app_log(&format!(
        "connect {} mode={} apps={}",
        card.name, mode_label, list.len()
    ));
    let child = vpn::spawn_engine().map_err(|e| e)?;
    let pid = child.id();
    // The handle must outlive this command (dropping kills the engine);
    // the PID file + tracked pid own the lifecycle from here.
    std::mem::forget(child);
    *engine.0.lock().unwrap() = Some(pid);
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    // A stop during settle clears the pid: drop our engine, report stopped.
    if *engine.0.lock().unwrap() != Some(pid) {
        vpn::request_graceful_stop(pid);
        return Ok(CmdResult { ok: false, msg: "Stopped.".into() });
    }
    if pid_alive(pid) && vpn::tun_routes_present() {
        Ok(CmdResult { ok: true, msg: format!("VPN on - {} carries the traffic.", card.name) })
    } else {
        *engine.0.lock().unwrap() = None;
        vpn::engine_cleanup();
        Ok(CmdResult { ok: false, msg: format!("Engine died: {}", vpn::engine_log_tail()) })
    }
}

#[tauri::command]
async fn tunnel_stop(engine: tauri::State<'_, Engine>) -> Result<CmdResult, String> {
    vpn::app_log("stop from app");
    stop_engine(&engine);
    Ok(CmdResult { ok: true, msg: "VPN off.".into() })
}

#[tauri::command]
async fn tunnel_status(engine: tauri::State<'_, Engine>) -> Result<TunnelState, String> {
    let pid = engine.0.lock().unwrap().clone();
    match pid {
        Some(p) if pid_alive(p) && vpn::tun_routes_present() => {
            Ok(TunnelState { running: true, error: String::new() })
        }
        Some(_) => {
            *engine.0.lock().unwrap() = None;
            Ok(TunnelState { running: false, error: vpn::engine_log_tail() })
        }
        None => {
            // Adopt a live engine we lost track of (e.g. after an app
            // restart with the tunnel still up from the pid file).
            if vpn::tun_routes_present() {
                if let Ok(s) = std::fs::read_to_string(vpn::engine_dir().join("engine.pid")) {
                    if let Ok(p) = s.trim().parse::<u32>() {
                        if p != 0 && pid_alive(p) {
                            *engine.0.lock().unwrap() = Some(p);
                            return Ok(TunnelState { running: true, error: String::new() });
                        }
                    }
                }
            }
            Ok(TunnelState { running: false, error: String::new() })
        }
    }
}

/// Session counts for the tunnel itself: the TUN adapter's own byte
/// counters (InOctets = downloaded, OutOctets = uploaded). The adapter
/// only exists while the engine runs, so zeros mean nothing to show.
#[cfg(windows)]
fn tun_octets() -> (u64, u64) {
    use windows::Win32::Foundation::NO_ERROR;
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table) != NO_ERROR || table.is_null() {
            return (0, 0);
        }
        let rows = std::slice::from_raw_parts(
            (*table).Table.as_ptr(),
            (*table).NumEntries as usize,
        );
        // A force-killed run can leave a ghost adapter carrying the same
        // name as the live one, and a ghost reports zeros forever. Take the
        // busiest match instead of the first.
        let mut best = (0u64, 0u64);
        for row in rows {
            let alias = String::from_utf16_lossy(&row.Alias);
            let desc = String::from_utf16_lossy(&row.Description);
            let alias = alias.trim_end_matches('\0');
            let desc = desc.trim_end_matches('\0');
            let ours = alias.starts_with("QuotaCards")
                || desc.contains("QuotaCards")
                || desc.to_ascii_lowercase().contains("wintun")
                || desc.to_ascii_lowercase().contains("sing-box");
            if ours && row.InOctets + row.OutOctets > best.0 + best.1 {
                best = (row.InOctets, row.OutOctets);
            }
        }
        FreeMibTable(table as *const core::ffi::c_void);
        best
    }
}

#[cfg(not(windows))]
fn tun_octets() -> (u64, u64) {
    (0, 0)
}

/// Session traffic in bytes, live from the TUN adapter counters.
#[tauri::command]
async fn tunnel_traffic() -> Result<TrafficState, String> {
    let (rx, tx) = tun_octets();
    Ok(TrafficState { rx, tx })
}

#[tauri::command]
async fn tunnel_log() -> Result<String, String> {
    Ok(read_log_tail(300))
}

#[tauri::command]
async fn tunnel_copy_log(app: tauri::AppHandle) -> Result<CmdResult, String> {
    let lines = read_log_tail(300);
    if lines.trim().is_empty() {
        return Ok(CmdResult { ok: false, msg: "No log yet - connect the VPN first.".into() });
    }
    app.clipboard()
        .write_text(lines)
        .map_err(|e| e.to_string())?;
    Ok(CmdResult { ok: true, msg: "Log copied - paste it to Cypher.".into() })
}

/// Curated Windows processes for per-app routing (exe name + label).
/// The engine matches by process name/path; whole-PC stays the default.
#[tauri::command]
async fn tunnel_apps() -> Result<String, String> {
    // Live list: whatever Windows is actually running right now, one row
    // per distinct exe. Nothing hardcoded, nothing curated.
    const SKIP: &[&str] = &[
        "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
        "services.exe", "lsass.exe", "lsm.exe", "svchost.exe", "dwm.exe", "explorer.exe",
        "ctfmon.exe", "conhost.exe", "dllhost.exe", "taskhostw.exe", "sihost.exe",
        "fontdrvhost.exe", "backgroundtaskhost.exe", "runtimebroker.exe",
        "searchindexer.exe", "searchhost.exe", "startmenuexperiencehost.exe",
        "shellexperiencehost.exe", "applicationframehost.exe", "systemsettings.exe",
        "lockapp.exe", "widgets.exe", "msedgewebview2.exe", "quotacards.exe",
        "tasklist.exe",
    ];
    let out = std::process::Command::new("tasklist.exe")
        .args(["/FO", "CSV", "/NH"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("list failed: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut seen = std::collections::BTreeSet::<String>::new();
    let mut rows: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('"') {
            continue;
        }
        let end = match line[1..].find('"') {
            Some(i) => i + 1,
            None => continue,
        };
        let exe = line[1..end].to_string();
        let low = exe.to_ascii_lowercase();
        if !low.ends_with(".exe") || SKIP.contains(&low.as_str()) {
            continue;
        }
        if !seen.insert(low) {
            continue;
        }
        let label = exe.strip_suffix(".exe").unwrap_or(&exe).to_string();
        rows.push((exe, label));
        if rows.len() >= 400 {
            break;
        }
    }
    rows.sort_by(|a, b| a.0.to_ascii_lowercase().cmp(&b.0.to_ascii_lowercase()));
    let v: Vec<serde_json::Value> = rows
        .iter()
        .map(|(pkg, label)| serde_json::json!({ "pkg": pkg, "label": label }))
        .collect();
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

/// Resolve the server name to its numeric IP for display (the UI shows the
/// real IP; the name stays for the tunnel itself). Prefers IPv4.
#[tauri::command]
async fn resolve_host(host: String) -> Result<String, String> {
    let mut addrs = tokio::net::lookup_host((host.as_str(), 443))
        .await
        .map_err(|e| format!("cannot resolve {host}: {e}"))?;
    let mut v6: Option<String> = None;
    for a in &mut addrs {
        let ip = a.ip();
        if ip.is_ipv4() {
            return Ok(ip.to_string());
        }
        if v6.is_none() {
            v6 = Some(ip.to_string());
        }
    }
    v6.ok_or_else(|| format!("cannot resolve {host}"))
}

/// Raw TCP check to server:443. Run BEFORE starting the VPN: if this fails,
/// the carrier blocks the port and no tunnel can work. Run AFTER: proves
/// traffic flows through the tunnel.
#[tauri::command]
async fn tunnel_probe(app: tauri::AppHandle) -> Result<CmdResult, String> {
    let host = {
        let state = app.state::<State>();
        let guard = state.0.lock().unwrap();
        guard.server_ip.clone()
    };
    if host.is_empty() {
        return Ok(CmdResult { ok: false, msg: "No server set.".into() });
    }
    let target = format!("{host}:443");
    let conn = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::net::TcpStream::connect(&target),
    )
    .await;
    match conn {
        Ok(Ok(_)) => Ok(CmdResult { ok: true, msg: format!("{target} reachable.") }),
        Ok(Err(e)) => Ok(CmdResult { ok: false, msg: format!("{target} refused: {e}") }),
        Err(_) => Ok(CmdResult { ok: false, msg: format!("{target} timed out (blocked?).") }),
    }
}

/// Update check through the signed updater feed. Reports only; the
/// install path is `apply_update` (official flow, restarts by itself).
#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    url: String,
}

/// Exit address plus provider for the speed page, resolved in Rust so no
/// webview policy, CORS rule or fetch quirk can block it. The UI tries its
/// own lookups first; this is the dependable path.
#[derive(serde::Serialize)]
struct NetInfo {
    ip: String,
    isp: String,
    place: String,
}

fn join_place(city: Option<&str>, country: Option<&str>) -> String {
    match (city, country) {
        (Some(c), Some(k)) => format!("{c}, {k}"),
        (Some(c), None) => c.to_string(),
        (None, Some(k)) => k.to_string(),
        _ => String::new(),
    }
}

#[tauri::command]
async fn net_info() -> Option<NetInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("QuotaCards")
        .build()
        .ok()?;

    if let Ok(r) = client.get("https://ipwho.is/").send().await {
        if let Ok(v) = r.json::<serde_json::Value>().await {
            if v.get("success").and_then(|x| x.as_bool()) != Some(false) {
                if let Some(ip) = v.get("ip").and_then(|x| x.as_str()) {
                    if !ip.is_empty() {
                        let isp = v
                            .pointer("/connection/isp")
                            .and_then(|x| x.as_str())
                            .or_else(|| v.pointer("/connection/org").and_then(|x| x.as_str()))
                            .unwrap_or("")
                            .to_string();
                        let place = join_place(
                            v.get("city").and_then(|x| x.as_str()),
                            v.get("country").and_then(|x| x.as_str()),
                        );
                        return Some(NetInfo { ip: ip.to_string(), isp, place });
                    }
                }
            }
        }
    }

    if let Ok(r) = client.get("https://ipapi.co/json/").send().await {
        if let Ok(v) = r.json::<serde_json::Value>().await {
            if let Some(ip) = v.get("ip").and_then(|x| x.as_str()) {
                if !ip.is_empty() {
                    let isp = v.get("org").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let place = join_place(
                        v.get("city").and_then(|x| x.as_str()),
                        v.get("country_name").and_then(|x| x.as_str()),
                    );
                    return Some(NetInfo { ip: ip.to_string(), isp, place });
                }
            }
        }
    }

    // Last resort: Cloudflare's trace endpoint, on the same host the speed
    // test itself uses. It carries no provider, but an address beats a dash.
    if let Ok(t) = client.get("https://cloudflare.com/cdn-cgi/trace").send().await {
        if let Ok(body) = t.text().await {
            let ip = body
                .lines()
                .find_map(|l| l.strip_prefix("ip="))
                .unwrap_or("")
                .trim()
                .to_string();
            if !ip.is_empty() {
                return Some(NetInfo { ip, isp: String::new(), place: String::new() });
            }
        }
    }

    None
}

/// The speed-test server list, fetched backend-side. Two sources: Ookla's
/// public list (the same one speedtest.net and its CLI select from, which
/// includes servers hosted inside providers like this user's own ISP) and the
/// LibreSpeed public list as a fallback pool. Neither sends CORS headers, so
/// the webview cannot read them, only the backend can.
#[tauri::command]
async fn speed_servers() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent(BROWSER_UA)
        .build()
        .ok()?;

    let mut ookla: Option<String> = None;
    let mut libre: Option<String> = None;

    let ookla_url = "https://www.speedtest.net/api/js/servers?engine=js&limit=60";
    if let Ok(r) = client.get(ookla_url).header("Accept", "application/json").send().await {
        if r.status().is_success() {
            if let Ok(t) = r.text().await {
                let t = t.trim().to_string();
                if t.starts_with('[') {
                    ookla = Some(t);
                }
            }
        }
    }

    if let Ok(r) = client
        .get("https://librespeed.org/backend-servers/servers.php")
        .send()
        .await
    {
        if r.status().is_success() {
            if let Ok(t) = r.text().await {
                let t = t.trim().to_string();
                if t.starts_with('[') {
                    libre = Some(t);
                }
            }
        }
    }

    if ookla.is_none() && libre.is_none() {
        return None;
    }
    Some(format!(
        "{{\"ookla\":{},\"librespeed\":{}}}",
        ookla.unwrap_or_else(|| "null".into()),
        libre.unwrap_or_else(|| "null".into())
    ))
}

const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

/// No overall timeout: a measurement stream is supposed to run for seconds.
/// `follow` is off for latency probes: the first response is the round trip,
/// and for servers that redirect http to https, following it would time two
/// trips and report a ping twice the real one.
fn speed_client(follow: bool) -> reqwest::Client {
    let policy = if follow {
        reqwest::redirect::Policy::default()
    } else {
        reqwest::redirect::Policy::none()
    };
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(6))
        // No single read may stall forever: a download or upload phase must be
        // able to give up and report why.
        .read_timeout(std::time::Duration::from_secs(4))
        .user_agent(BROWSER_UA)
        .redirect(policy)
        // HTTP/1.1 for the measurement: these endpoints serve bytes and acks,
        // and h1 avoids HTTP/2 flow-control stalls through the odd middlebox.
        .http1_only()
        .build()
        .unwrap_or_default()
}

#[tauri::command]
async fn speed_latency(url: String, probes: u32) -> Vec<f64> {
    speed::latency(&speed_client(false), &url, probes.clamp(1, 10)).await
}

/// Whether a server can actually be used end to end: the probe follows
/// redirects, because several provider hosts answer their own name with a 307
/// to an Ookla hostname, and a machine that cannot resolve or reach that
/// second name fails on every download and upload while a plain ping still
/// works. Candidates that cannot complete the full path are not offered.
#[tauri::command]
async fn speed_reach(url: String) -> bool {
    !speed::latency(&speed_client(true), &url, 1).await.is_empty()
}

#[tauri::command]
async fn speed_down(app: tauri::AppHandle, urls: Vec<String>, seconds: f64) -> speed::SpeedOut {
    speed::download(&speed_client(true), &urls, seconds.clamp(1.0, 30.0), |v| {
        let _ = app.emit("speed-tick", v);
    })
    .await
}

#[tauri::command]
async fn speed_up(
    app: tauri::AppHandle,
    url: String,
    seconds: f64,
    chunk_mb: Option<u32>,
) -> speed::SpeedOut {
    let chunk = chunk_mb.unwrap_or(2).clamp(1, 8) as usize;
    speed::upload(&speed_client(true), &url, seconds.clamp(2.0, 30.0), chunk, |v| {
        let _ = app.emit("speed-tick", v);
    })
    .await
}

/// Whether the bundled official client is fetched and runnable. The first
/// call downloads it once and caches it under the app data dir.
#[tauri::command]
async fn speedtest_cli_ready() -> bool {
    ookla::ensure_binary().await.is_some()
}

/// One full test through the official Ookla client. Live progress arrives as
/// `speed-phase` and `speed-tick` events.
#[tauri::command]
async fn speedtest_cli(app: tauri::AppHandle) -> Option<ookla::CliResult> {
    let exe = ookla::ensure_binary().await?;
    let a1 = app.clone();
    let on_phase: std::sync::Arc<dyn Fn(&str) + Send + Sync> =
        std::sync::Arc::new(move |p: &str| {
            let _ = a1.emit("speed-phase", p.to_string());
        });
    let a2 = app.clone();
    let on_tick: std::sync::Arc<dyn Fn(f64) + Send + Sync> =
        std::sync::Arc::new(move |v: f64| {
            let _ = a2.emit("speed-tick", v);
        });
    tauri::async_runtime::spawn_blocking(move || ookla::run(&exe, on_phase, on_tick))
        .await
        .ok()
        .flatten()
}

fn newer(latest: &str, current: &str) -> bool {
    // Numeric dot-part compare, no semver crate needed.
    let p = |s: &str| {
        s.split('.')
            .map(|x| x.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    p(latest) > p(current)
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    const REPO: &str = "YousefMohiey/QuotaCards";
    let current = env!("CARGO_PKG_VERSION").to_string();
    let found = app
        .updater()
        .map_err(|e| format!("updater unavailable: {e}"))?
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?;
    match found {
        Some(u) => Ok(UpdateInfo {
            available: newer(&u.version, &current),
            url: format!("https://github.com/{REPO}/releases/tag/v{}", u.version),
            latest: u.version,
            current,
        }),
        None => Ok(UpdateInfo {
            available: false,
            url: String::new(),
            latest: current.clone(),
            current,
        }),
    }
}

/// Install the update by itself: stop the tunnel (the installer needs
/// the TUN device free), download + verify + run the signed setup,
/// then restart into the new build. Progress goes to the UI as
/// `update-progress` events with a `pct` field.
#[tauri::command]
async fn apply_update(app: tauri::AppHandle) -> Result<String, String> {
    {
        let eng = app.state::<Engine>();
        stop_engine(&eng);
    }
    let update = app
        .updater()
        .map_err(|e| format!("updater unavailable: {e}"))?
        .check()
        .await
        .map_err(|e| format!("check failed: {e}"))?
        .ok_or_else(|| "Already on the latest build.".to_string())?;
    let prog = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                let pct = total.map(|t| {
                    if t > 0 {
                        ((chunk as u64 * 100 / t).min(100)) as usize
                    } else {
                        0
                    }
                });
                let _ = prog.emit(
                    "update-progress",
                    serde_json::json!({"chunk": chunk, "total": total, "pct": pct}),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("install failed: {e}"))?;
    app.restart();
}

pub fn run() {
    tauri::Builder::default()
        // Single instance: a second launch brings the running app forward
        // instead of starting a twin. Must be the first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(State(Mutex::new(AppConfig::default())))
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            // Same OS config dir as the previous desktop app: cards carry
            // over, nothing to re-enter. (No chdir - that is phone-only.)
            let cfg = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                initial_config,
            ))
            .unwrap_or_default();
            *app.state::<State>().0.lock().unwrap() = cfg;
            // Tray: the app lives here. Closing the window only hides it;
            // Quit from this menu is the real exit (engine stopped first).
            let show = MenuItem::with_id(app, "show", "Show QuotaCards", true, None::<&str>)?;
            let check = MenuItem::with_id(app, "check", "Check for updates", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &check, &quit])?;
            let raw = image::load_from_memory_with_format(
                include_bytes!("../icons/32x32.png"),
                image::ImageFormat::Png,
            )
            .map_err(|e| format!("tray icon: {e}"))?
            .to_rgba8();
            let (w, h) = (raw.width(), raw.height());
            let icon = tauri::image::Image::new_owned(raw.into_raw(), w, h);
            let handle = app.handle().clone();
            TrayIconBuilder::with_id("main")
                .icon(icon)
                .tooltip("QuotaCards")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(&handle)?;
            // Once per update, quietly re-register every local card on the
            // server so a wiped or rebuilt server heals on launch, not only
            // when the user connects.
            spawn_launch_refresh(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // X hides to the tray instead of quitting; the tunnel keeps
            // running and the icon stays until Quit is picked there.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "check" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app.emit("tray-check-updates", ());
            }
            "quit" => {
                let eng = app.state::<Engine>();
                stop_engine(&eng);
                app.exit(0);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            probe_server,
            generate_card,
            import_card,
            revoke_card,
            copy_card,
            tunnel_start,
            tunnel_stop,
            tunnel_status,
            tunnel_traffic,
            tunnel_log,
            tunnel_copy_log,
            tunnel_probe,
            tunnel_apps,
            resolve_host,
            check_update,
            apply_update,
            net_info,
            speed_servers,
            speed_latency,
            speed_reach,
            speed_down,
            speed_up,
            speedtest_cli_ready,
            speedtest_cli
        ])
        .run(tauri::generate_context!())
        .expect("QuotaCards failed to start");
}

#[cfg(all(test, windows))]
mod tests {
    use windows::Win32::Foundation::NO_ERROR;
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};

    /// The traffic chart leans on this API; prove the table reads here.
    #[test]
    fn if_table_is_readable() {
        unsafe {
            let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
            assert_eq!(GetIfTable2(&mut table), NO_ERROR);
            let rows = std::slice::from_raw_parts(
                (*table).Table.as_ptr(),
                (*table).NumEntries as usize,
            );
            assert!(!rows.is_empty());
            for row in rows.iter().take(8) {
                let alias = String::from_utf16_lossy(&row.Alias);
                println!(
                    "{} in={} out={}",
                    alias.trim_end_matches('\0'),
                    row.InOctets,
                    row.OutOctets
                );
            }
            FreeMibTable(table as *const core::ffi::c_void);
        }
    }

    #[test]
    fn tun_octets_never_panics() {
        let (rx, tx) = super::tun_octets();
        println!("tun_octets -> {rx}/{tx}");
    }
}
