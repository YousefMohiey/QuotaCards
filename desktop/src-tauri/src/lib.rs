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
}

fn snapshot(cfg: &AppConfig) -> UiState {
    UiState {
        server_ip: cfg.server_ip.clone(),
        ssh_user: cfg.ssh_user.clone(),
        ssh_port: cfg.ssh_port,
        cards: cfg.cards.clone(),
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
fn get_state(state: tauri::State<State>) -> UiState {
    snapshot(&state.0.lock().unwrap())
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
    if let Err(e) = server::add_client(&host, port, &user, &key, &uuid).await {
        return Ok(CmdResult { ok: false, msg: format!("Failed: {e}") });
    }
    {
        let mut cfg = state.0.lock().unwrap();
        cfg.cards.push(card);
        cfg.save();
    }
    Ok(CmdResult { ok: true, msg: "Card created.".into() })
}

#[tauri::command]
async fn revoke_card(state: tauri::State<'_, State>, uuid: String) -> Result<CmdResult, String> {
    let (host, user, port, key) = {
        let mut cfg = state.0.lock().unwrap();
        cfg.cards.retain(|c| c.uuid != uuid);
        cfg.save();
        (cfg.server_ip.clone(), cfg.ssh_user.clone(), cfg.ssh_port, cfg.private_key.clone())
    };
    // WireGuard peers are per-card: drop this card's peer too (best effort).
    server::wg_del(&host, port, &user, &key, &uuid).await;
    match server::remove_client(&host, port, &user, &key, &uuid).await {
        Ok(_) => Ok(CmdResult { ok: true, msg: "Card revoked.".into() }),
        Err(e) => Ok(CmdResult { ok: false, msg: format!("Revoke failed: {e}") }),
    }
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
    let mode = apps_mode.unwrap_or_default();
    if mode == "block" {
        return Ok(CmdResult { ok: false, msg: "All-but-these is phone-only for now.".into() });
    }
    let list = apps.unwrap_or_default();
    let apps_only = mode == "allow" && !list.is_empty();
    vpn::ensure_engine().map_err(|e| e)?;
    vpn::write_tun_config(&card.uuid, &host, &card.sni, apps_only, &list).map_err(|e| e)?;
    vpn::check_config().map_err(|e| e)?;
    stop_engine(&engine);
    vpn::app_log(&format!(
        "connect {} mode={} apps={}",
        card.name,
        if apps_only { "apps" } else { "all" },
        list.len()
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

/// Session traffic in bytes. Desktop has no per-app counters like the
/// phone does, so the UI timer runs off its own clock and this stays zero.
#[tauri::command]
async fn tunnel_traffic() -> Result<TrafficState, String> {
    Ok(TrafficState { rx: 0, tx: 0 })
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
                include_bytes!("../icons/128x128.png"),
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
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("QuotaCards failed to start");
}
