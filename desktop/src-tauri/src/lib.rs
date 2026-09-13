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
use tauri_plugin_clipboard_manager::ClipboardExt;

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

/// Update check against GitHub releases. No installer exists on purpose:
/// the app ships as a plain zip, so this only reports and opens the
/// release page; the user replaces the exe by hand.
#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    url: String,
    zip_url: String,
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
async fn check_update() -> Result<UpdateInfo, String> {
    const REPO: &str = "YousefMohiey/QuotaCards";
    let current = env!("CARGO_PKG_VERSION").to_string();
    let out = std::process::Command::new("curl.exe")
        .args([
            "-s",
            "--max-time",
            "20",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: quotacards-updater",
            &format!("https://api.github.com/repos/{REPO}/releases/latest"),
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("check failed: {e}"))?;
    if !out.status.success() {
        return Err("Could not reach GitHub.".to_string());
    }
    let v: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|_| "GitHub answer unreadable.".to_string())?;
    let tag = v
        .get("tag_name")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim_start_matches(['v', 'V'])
        .to_string();
    if tag.is_empty() {
        return Err("No releases published yet.".to_string());
    }
    let url = v
        .get("html_url")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    // The exact zip the release ships for this app, nothing else.
    let zip_url = v
        .get("assets")
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter().find_map(|x| {
                if x.get("name").and_then(|s| s.as_str()) == Some("quotacards-win.zip") {
                    x.get("browser_download_url")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or_default();
    Ok(UpdateInfo {
        available: newer(&tag, &current),
        latest: tag,
        url,
        zip_url,
        current,
    })
}

/// Open the release page in the default browser (zero new deps).
#[tauri::command]
async fn open_update_url(url: String) -> Result<String, String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("could not open: {e}"))?;
    Ok("opened".to_string())
}

/// Install the update by itself: download the release zip, unpack it in
/// TEMP, then hand over to a small waiter script that swaps the two app
/// files after this process exits (a running exe cannot replace itself)
/// and starts the new build. No installer, no extra tools.
#[tauri::command]
async fn apply_update(url: String) -> Result<String, String> {
    if !url.starts_with("https://github.com/")
        && !url.starts_with("https://objects.githubusercontent.com/")
    {
        return Err("Bad update address.".to_string());
    }
    let exe = std::env::current_exe().map_err(|e| format!("where am i: {e}"))?;
    let dir = exe.parent().ok_or("No app folder.")?.to_path_buf();
    // Prove the folder is writable NOW: after exit nobody can report back.
    let probe = dir.join(".qc-write-test");
    std::fs::write(&probe, b"1")
        .map_err(|_| "App folder is not writable. Move the app somewhere you own, then update.".to_string())?;
    let _ = std::fs::remove_file(&probe);
    let stage = std::env::temp_dir().join("qc-update");
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| format!("stage: {e}"))?;
    let zip = stage.join("update.zip");
    let dl = std::process::Command::new("curl.exe")
        .args(["-sL", "--max-time", "300", "-o"])
        .arg(&zip)
        .arg(&url)
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("download failed: {e}"))?;
    if !dl.status.success() {
        return Err("Download failed.".to_string());
    }
    let ext = stage.join("files");
    let ps = format!(
        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        zip.display(),
        ext.display()
    );
    let un = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &ps])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("unpack failed: {e}"))?;
    if !un.status.success() || !ext.join("quotacards.exe").exists() {
        return Err("Update package broken.".to_string());
    }
    let pid = std::process::id();
    let bat = stage.join("swap.bat");
    let script = format!(
        "@echo off\r\n:wait\r\ntasklist /FI \"PID eq {pid}\" 2>NUL | find \"{pid}\" >NUL\r\nif not errorlevel 1 (timeout /t 1 /nobreak >NUL & goto wait)\r\ncopy /Y \"{src}\\quotacards.exe\" \"{dir}\\\" >NUL\r\ncopy /Y \"{src}\\WebView2Loader.dll\" \"{dir}\\\" >NUL\r\nstart \"\" \"{dir}\\quotacards.exe\"\r\n(goto) 2>NUL & del \"%~f0\"\r\n",
        pid = pid,
        src = ext.display(),
        dir = dir.display()
    );
    std::fs::write(&bat, script).map_err(|e| format!("swap script: {e}"))?;
    std::process::Command::new("cmd")
        .args(["/C", "start", "/MIN", "", &bat.to_string_lossy()])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("could not start installer: {e}"))?;
    std::process::exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
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
            Ok(())
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
            open_update_url,
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("QuotaCards failed to start");
}
