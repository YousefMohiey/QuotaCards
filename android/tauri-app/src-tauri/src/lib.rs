//! QuotaCards mobile backend (Tauri) - Phase 1.
//!
//! Same core as desktop: server setup + card generate/revoke over SSH.
//! Tunnel connect (Phase 2) needs a Kotlin VpnService + Go libbox.

use quotacards::{
    config::{AppConfig, Card, EMBED_KEY, DEFAULT_HOST, DEFAULT_PORT, DEFAULT_USER},
    server,
};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_qctunnel::TunnelExt;

struct State(Mutex<AppConfig>);

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
    // desktop app runs on open (add + revoke a throwaway client).
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

/// Whole-device sing-box config for one card. Mirrors the desktop whole-PC
/// mode: gVisor TUN, DNS through the tunnel, server IPs excluded (no loop).
/// transport: "vless" (standard, TCP+TLS), "hy2" (game, UDP+TLS+SNI),
/// "wg" (raw WireGuard UDP, no SNI - packages do not apply).
async fn android_tun_config(uuid: &str, host: &str, sni: &str, transport: &str, hy2_pass: &str, wg: Option<(&str, &str, &str)>) -> Result<String, String> {
    use std::collections::BTreeSet;
    let mut excludes = BTreeSet::new();
    match tokio::net::lookup_host((host, 443)).await {
        Ok(addrs) => {
            for a in addrs {
                let ip = a.ip();
                excludes.insert(format!("{ip}/{}", if ip.is_ipv4() { 32 } else { 128 }));
            }
        }
        Err(e) => return Err(format!("cannot resolve {host}: {e}")),
    }
    if excludes.is_empty() {
        return Err(format!("cannot resolve {host}"));
    }
    excludes.insert("1.1.1.1/32".into());
    excludes.insert("8.8.8.8/32".into());
    let excl: Vec<&String> = excludes.iter().collect();
    // Dial the resolved IP, not the domain: on Android the engine may have
    // no usable resolver at startup (no interface reported yet), so a
    // hostname here deadlocks the whole tunnel - no DNS, no uplink, nothing.
    // TLS SNI stays the domain, so the server sees the same handshake.
    // Freshly resolved on every connect, same as desktop.
    let server_ip = excludes
        .iter()
        .filter(|c| *c != "1.1.1.1/32" && *c != "8.8.8.8/32")
        .find(|c| c.ends_with("/32"))
        .or_else(|| excludes.iter().next())
        .and_then(|c| c.split('/').next())
        .unwrap_or(host)
        .to_string();
    // Engine 1.13+ removed the wireguard OUTBOUND: WireGuard now lives as
    // an ENDPOINT (official migration). The endpoint keeps the "proxy" tag
    // so route + DNS point at the same name, untouched.
    let mut endpoints: Vec<serde_json::Value> = Vec::new();
    let proxy_outbound = match transport {
        "hy2" => serde_json::json!({
            "type": "hysteria2",
            "tag": "proxy",
            "server": server_ip,
            "server_port": 443,
            "password": hy2_pass,
            "up_mbps": 10,
            "down_mbps": 50,
            "tls": {
                "enabled": true,
                "server_name": sni,
                "insecure": true,
                "alpn": ["h3"]
            }
        }),
        "wg" => {
            let (privkey, addr, srv_pub) = wg.unwrap_or(("", "", ""));
            endpoints.push(serde_json::json!({
                "type": "wireguard",
                "tag": "proxy",
                "address": [addr],
                "private_key": privkey,
                "peers": [{
                    "address": server_ip,
                    "port": 53,
                    "public_key": srv_pub,
                    "allowed_ips": ["0.0.0.0/0"],
                    "persistent_keepalive_interval": 25
                }],
                "mtu": 1280
            }));
            // Placeholder: replaced below by outbounds without a proxy entry
            // (the endpoint carries the tag instead).
            serde_json::json!({ "type": "direct", "tag": "direct" })
        }
        _ => serde_json::json!({
            "type": "vless",
            "tag": "proxy",
            "server": server_ip,
            "server_port": 443,
            "uuid": uuid,
            "tls": {
                "enabled": true,
                "server_name": sni,
                "insecure": true,
                "alpn": ["h3", "h2", "http/1.1"],
                // Mirror the card link (fp=random): NekoBox randomizes the
                // handshake the same way, and that is what counts correctly.
                "utls": {"enabled": true, "fingerprint": "random"}
            }
        }),
    };
    let outbounds = if transport == "wg" {
        // WireGuard mode: the endpoint above carries the "proxy" tag, so
        // only the plain direct outbound remains here (no duplicate tags).
        vec![serde_json::json!({"type": "direct", "tag": "direct"})]
    } else {
        vec![proxy_outbound, serde_json::json!({"type": "direct", "tag": "direct"})]
    };
    let cfg = serde_json::json!({
        "log": {"level": "warning"},
        "dns": {
            "servers": [
                {"type": "https", "tag": "proxy-dns", "server": "1.1.1.1", "detour": "proxy"},
                {"type": "udp", "tag": "direct-dns", "server": "8.8.8.8"}
            ],
            "rules": [{"domain": [host], "server": "direct-dns"}],
            "final": "proxy-dns"
        },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "mtu": 9000,
            "address": ["172.19.0.1/30"],
            "auto_route": true,
            "strict_route": true,
            "stack": "gvisor",
            "route_exclude_address": excl
        }],
        "outbounds": outbounds,
        "endpoints": endpoints,
        "route": {
            "rules": [
                {"action": "sniff"},
                {"network": "udp", "port": [135, 137, 138, 139, 5353], "action": "reject"},
                {"ip_cidr": ["224.0.0.0/3", "ff00::/8"], "action": "reject"},
                {"source_ip_cidr": ["224.0.0.0/3", "ff00::/8"], "action": "reject"},
                {"protocol": "dns", "action": "hijack-dns"}
            ],
            "final": "proxy",
            "auto_detect_interface": true,
            "default_domain_resolver": "direct-dns"
        }
    });
    serde_json::to_string(&cfg).map_err(|e| format!("config: {e}"))
}

#[tauri::command]
async fn tunnel_start(app: tauri::AppHandle, uuid: String, apps_mode: Option<String>, apps: Option<Vec<String>>, transport: Option<String>) -> Result<CmdResult, String> {
    let (host, user, port, key, card) = {
        let state = app.state::<State>();
        let cfg = state.0.lock().unwrap();
        let Some(card) = cfg.cards.iter().find(|c| c.uuid == uuid).cloned() else {
            return Ok(CmdResult { ok: false, msg: "Card not found.".into() });
        };
        (cfg.server_ip.clone(), cfg.ssh_user.clone(), cfg.ssh_port, cfg.private_key.clone(), card)
    };
    if host.is_empty() {
        return Ok(CmdResult { ok: false, msg: "Set up your server first.".into() });
    }
    let t = match transport.as_deref().unwrap_or("vless") {
        "hy2" => "hy2",
        "wg" => "wg",
        _ => "vless",
    };
    // Provision whatever the transport needs (cached after first use).
    let mut hy2_pass = String::new();
    let mut wg_tuple: Option<(String, String, String)> = None;
    if t == "hy2" {
        let cached = app.state::<State>().0.lock().unwrap().hy2_password.clone();
        hy2_pass = if cached.is_empty() {
            let p = server::hy2_password(&host, port, &user, &key).await?;
            let state = app.state::<State>();
            let mut st = state.0.lock().unwrap();
            st.hy2_password = p.clone();
            st.save();
            p
        } else {
            cached
        };
    } else if t == "wg" {
        if card.wg_private.is_empty() || card.wg_addr.is_empty() {
            let c = server::wg_add(&host, port, &user, &key, &card.uuid).await?;
            let state = app.state::<State>();
            let mut st = state.0.lock().unwrap();
            if let Some(cc) = st.cards.iter_mut().find(|c| c.uuid == uuid) {
                cc.wg_private = c.private_key.clone();
                cc.wg_addr = c.address.clone();
            }
            st.wg_server_pub = c.server_pub.clone();
            st.save();
            wg_tuple = Some((c.private_key, c.address, c.server_pub));
        } else {
            let mut srvpub = app.state::<State>().0.lock().unwrap().wg_server_pub.clone();
            if srvpub.is_empty() {
                srvpub = server::wg_server_pub(&host, port, &user, &key).await?;
                let state = app.state::<State>();
            let mut st = state.0.lock().unwrap();
                st.wg_server_pub = srvpub.clone();
                st.save();
            }
            wg_tuple = Some((card.wg_private.clone(), card.wg_addr.clone(), srvpub));
        }
    }
    let wg_ref = wg_tuple.as_ref().map(|(p, a, s)| (p.as_str(), a.as_str(), s.as_str()));
    let config = android_tun_config(&card.uuid, &host, &card.sni, t, &hy2_pass, wg_ref).await?;
    // config errors return Err (red banner); Kotlin start errors come via status poll
    let mode = apps_mode.unwrap_or_default();
    let list = apps.unwrap_or_default().join(",");
    app.tunnel().start(config, Some(list), Some(mode)).map_err(|e| e.to_string())?;
    Ok(CmdResult { ok: true, msg: format!("VPN starting - {} carries the traffic.", card.name) })
}

#[tauri::command]
async fn tunnel_stop(app: tauri::AppHandle) -> Result<CmdResult, String> {
    app.tunnel().stop().map_err(|e| e.to_string())?;
    Ok(CmdResult { ok: true, msg: "VPN off.".into() })
}

#[tauri::command]
async fn tunnel_status(app: tauri::AppHandle) -> Result<TunnelState, String> {
    let (running, error) = app.tunnel().status().map_err(|e| e.to_string())?;
    Ok(TunnelState { running, error: error.unwrap_or_default() })
}

/// Session traffic in bytes since connect.
#[tauri::command]
async fn tunnel_traffic(app: tauri::AppHandle) -> Result<TrafficState, String> {
    let (rx, tx) = app.tunnel().traffic().map_err(|e| e.to_string())?;
    Ok(TrafficState { rx, tx })
}

#[tauri::command]
async fn tunnel_log(app: tauri::AppHandle) -> Result<String, String> {
    app.tunnel().log().map_err(|e| e.to_string())
}

#[tauri::command]
async fn tunnel_copy_log(app: tauri::AppHandle) -> Result<CmdResult, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let lines = app.tunnel().log().map_err(|e| e.to_string())?;
    if lines.trim().is_empty() {
        return Ok(CmdResult { ok: false, msg: "No log yet - connect the VPN first.".into() });
    }
    app.clipboard()
        .write_text(lines)
        .map_err(|e| e.to_string())?;
    Ok(CmdResult { ok: true, msg: "Log copied - paste it to Cypher.".into() })
}

/// Installed launchable apps (JSON) for the per-app picker.
#[tauri::command]
async fn tunnel_apps(app: tauri::AppHandle) -> Result<String, String> {
    app.tunnel().apps().map_err(|e| e.to_string())
}

/// System VPN screen, where Always-on + Block connections live.
#[tauri::command]
async fn tunnel_open_vpn_settings(app: tauri::AppHandle) -> Result<(), String> {
    app.tunnel().open_vpn_settings().map_err(|e| e.to_string())
}

/// Battery-exemption screen, so swiping the app away never drops the VPN.
#[tauri::command]
async fn tunnel_open_bg_settings(app: tauri::AppHandle) -> Result<(), String> {
    app.tunnel().open_bg_settings().map_err(|e| e.to_string())
}

/// Battery exemption state: true once background running is allowed.
#[tauri::command]
async fn tunnel_bg_status(app: tauri::AppHandle) -> Result<bool, String> {
    app.tunnel().bg_status().map_err(|e| e.to_string())
}

/// Update check against GitHub releases (phone: APK asset).
#[derive(serde::Serialize)]
struct UpdateInfo {
    current: String,
    latest: String,
    available: bool,
    url: String,
    apk_url: String,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let u = app.tunnel().check_update().map_err(|e| e.to_string())?;
    Ok(UpdateInfo {
        current: u.current,
        latest: u.latest,
        available: u.available,
        url: u.url,
        apk_url: u.apk_url,
    })
}

/// Download the new APK and open the system installer (one tap to confirm).
#[tauri::command]
async fn apply_update(app: tauri::AppHandle, apk_url: String) -> Result<CmdResult, String> {
    app.tunnel().install_update(apk_url).map_err(|e| e.to_string())?;
    Ok(CmdResult { ok: true, msg: "Installer opened.".into() })
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_qctunnel::init())
        .manage(State(Mutex::new(AppConfig::default())))
        .setup(|app| {
            // pin config to the app-private dir BEFORE any load/save.
            // dirs::config_dir() falls back to "." on Android, and every
            // command already saves to "./quotacards/config.json" after this
            // chdir - so init must happen here, not in manage(). (Do NOT
            // set HOME: that diverts dirs to a .config subdir and misses
            // the file the commands actually write.)
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::env::set_current_dir(&dir);
            }
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
            tunnel_open_vpn_settings,
            tunnel_open_bg_settings,
            tunnel_bg_status,
            resolve_host,
            check_update,
            apply_update
        ])
        .run(tauri::generate_context!())
        .expect("QuotaCards failed to start");
}
