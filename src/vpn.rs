//! Built-in TUN connection (no third-party client needed):
//! runs a pinned sing-box engine with a wintun TUN interface in auto-route
//! mode, so EVERYTHING on this PC (browsers, games, speed tests) goes
//! through the card's server. Needs admin (the app manifest requests it).
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const NO_WINDOW: u32 = 0x08000000;
#[cfg(not(windows))]
const NO_WINDOW: u32 = 0;

const SINGBOX_TAG: &str = "v1.14.0";
const WINTUN_TAG: &str = "0.14.1";
const WINTUN_URL: &str = "https://www.wintun.net/builds/wintun-0.14.1.zip";

/// Global tunnel-operation lock: engine stop/cleanup and engine spawn must
/// never overlap (a cleanup hunt racing a fresh spawn kills the new engine).
/// Hold it ONLY around spawn_engine calls - never around network waits,
/// settle sleeps or egress probes, or Disconnect hangs behind Connect.
pub static TUN_OPS: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Tunnel generation: bumped on every stop request. A connect thread that
/// finishes after a stop carries a stale gen and must quietly drop its
/// engine instead of reporting VpnUp (the UI already says Disconnected).
static TUN_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Bump the generation (call on the UI thread when stopping). Returns the
/// new generation.
pub fn bump_gen() -> u64 {
    TUN_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

/// Current generation (connect threads capture this, VpnUp carries it).
pub fn tunnel_gen() -> u64 {
    TUN_GEN.load(std::sync::atomic::Ordering::SeqCst)
}
pub const TUN_IP: &str = "172.19.0.1";
const DIRECT_DNS: &str = "8.8.8.8";
const PROXY_DOH_IP: &str = "1.1.1.1";

pub fn engine_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("quotacards").join("engine")
}

pub fn singbox_path() -> PathBuf {
    engine_dir().join("sing-box.exe")
}

pub fn wintun_path() -> PathBuf {
    engine_dir().join("wintun.dll")
}

pub fn tun_config_path() -> PathBuf {
    engine_dir().join("singbox-tun.json")
}

#[cfg(windows)]
fn cmd_hidden(prog: &str) -> Command {
    let mut c = Command::new(prog);
    c.creation_flags(NO_WINDOW);
    c
}

#[cfg(not(windows))]
fn cmd_hidden(prog: &str) -> Command {
    Command::new(prog)
}

fn run_hidden(prog: &str, args: &[&str]) -> Result<std::process::Output, String> {
    cmd_hidden(prog)
        .args(args)
        .output()
        .map_err(|e| format!("{prog}: {e}"))
}

/// True when running elevated. `net session` only succeeds as admin.
pub fn is_elevated() -> bool {
    run_hidden("net", &["session"])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Download + extract the sing-box engine (pinned) and wintun driver.
/// Version-stamped so a stale engine is replaced automatically.
pub fn ensure_engine() -> Result<String, String> {
    let dir = engine_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir: {e}"))?;
    // one-way migration: drop the legacy xray engine remnants
    for f in ["xray.exe", "xray-client.json", "xray.zip"] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    let ver_file = dir.join("tun-version.txt");
    let cur = std::fs::read_to_string(&ver_file).unwrap_or_default();
    let want = format!("sing-box {SINGBOX_TAG} + wintun {WINTUN_TAG}");
    if singbox_path().exists() && wintun_path().exists() && cur.trim() == want {
        return Ok("engine ready".to_string());
    }
    // --- sing-box ---
    let ver = SINGBOX_TAG.trim_start_matches('v');
    let zip = dir.join("sing-box.zip");
    let url = format!(
        "https://github.com/SagerNet/sing-box/releases/download/{SINGBOX_TAG}/sing-box-{ver}-windows-amd64.zip"
    );
    let dl = run_hidden(
        "curl",
        &[
            "-L", "--max-time", "180", "-A", "QuotaCards", "-o",
            &zip.to_string_lossy(), &url,
        ],
    )
    .map(|o| o.status.success())
    .unwrap_or(false)
        && zip.exists();
    if !dl {
        return Err("engine download failed (check internet)".to_string());
    }
    run_hidden(
        "tar",
        &["-xf", &zip.to_string_lossy(), "-C", &dir.to_string_lossy()],
    )
    .map_err(|e| format!("extract: {e}"))?;
    let _ = std::fs::remove_file(&zip);
    let inner = dir.join(format!("sing-box-{ver}-windows-amd64"));
    if singbox_path().exists() {
        let _ = std::fs::remove_file(singbox_path());
    }
    std::fs::rename(inner.join("sing-box.exe"), singbox_path())
        .map_err(|e| format!("install engine: {e}"))?;
    let _ = std::fs::remove_dir_all(inner);
    // --- wintun (driver DLL lives next to the engine exe) ---
    let wzip = dir.join("wintun.zip");
    let dl = run_hidden(
        "curl",
        &[
            "-L", "--max-time", "120", "-A", "QuotaCards", "-o",
            &wzip.to_string_lossy(), WINTUN_URL,
        ],
    )
    .map(|o| o.status.success())
    .unwrap_or(false)
        && wzip.exists();
    if !dl {
        return Err("driver download failed (check internet)".to_string());
    }
    run_hidden(
        "tar",
        &["-xf", &wzip.to_string_lossy(), "-C", &dir.to_string_lossy()],
    )
    .map_err(|e| format!("extract: {e}"))?;
    let _ = std::fs::remove_file(&wzip);
    std::fs::copy(
        dir.join("wintun").join("bin").join("amd64").join("wintun.dll"),
        wintun_path(),
    )
    .map_err(|e| format!("install driver: {e}"))?;
    let _ = std::fs::remove_dir_all(dir.join("wintun"));
    if singbox_path().exists() && wintun_path().exists() {
        let _ = std::fs::write(&ver_file, &want);
        Ok(format!("engine {SINGBOX_TAG} ready"))
    } else {
        Err("engine missing after extract".to_string())
    }
}

/// Resolve the server domain NOW (system DNS intact) so its IPs can be
/// excluded from TUN routing - otherwise the tunnel eats its own path.
pub fn resolve_server_ips(host: &str) -> Result<Vec<String>, String> {
    let mut ips: Vec<String> = format!("{host}:443")
        .to_socket_addrs()
        .map_err(|e| format!("can't resolve {host} ({e})"))?
        .map(|a| a.ip())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .map(|ip| {
            if ip.is_ipv4() {
                format!("{ip}/32")
            } else {
                format!("{ip}/128")
            }
        })
        .collect();
    ips.sort();
    if ips.is_empty() {
        return Err(format!("can't resolve {host}"));
    }
    Ok(ips)
}

/// Full TUN client config for one card. Self-signed server cert → insecure
/// (same trust as the share links); SNI stamp preserved.
/// `apps_mode` picks the per-app routing: "allow" sends ONLY the listed
/// process names through the tunnel, "block" sends everything EXCEPT them,
/// anything else routes the whole PC.
/// `voice` adds the VALORANT voice rules: only the voice/STUN ports and the
/// Vivox endpoints of the listed Riot processes ride the tunnel, everything
/// else (the game's own traffic included) stays direct.
pub fn write_tun_config(
    uuid: &str,
    host: &str,
    sni: &str,
    apps_mode: &str,
    apps: &[String],
    voice: bool,
) -> Result<PathBuf, String> {
    let mut excludes = resolve_server_ips(host)?;
    for ip in [PROXY_DOH_IP, DIRECT_DNS] {
        let cidr = format!("{ip}/32");
        if !excludes.contains(&cidr) {
            excludes.push(cidr);
        }
    }
    // allow mode with no list is normally a mistake, but the voice-only
    // session uses exactly that shape: keep its finals per-app so only the
    // voice channels ride the tunnel. Whole-device ("all") is untouched.
    let apps_only = apps_mode == "allow" && (!apps.is_empty() || voice);
    let apps_except = apps_mode == "block" && !apps.is_empty();
    let per_app = apps_only || apps_except;
    // unique adapter name per connect: a force-killed run can leave a ghost
    // adapter in the driver that would block a reused name.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let if_name = format!("QuotaCards{:04x}", nanos & 0xffff);
    // per-app routing matches by process, which needs the userspace stack
    // on Windows; whole-PC mode keeps the fast mixed stack.
    let tun_stack = if per_app { "gvisor" } else { "mixed" };
    let dns_final = if apps_only { "direct-dns" } else { "proxy-dns" };
    let route_final = if apps_only { "direct" } else { "proxy" };
    let mut route_rules = serde_json::json!([
        {"action": "sniff"},
        {"network": "udp", "port": [135, 137, 138, 139, 5353], "action": "reject"},
        {"ip_cidr": ["224.0.0.0/3", "ff00::/8"], "action": "reject"},
        {"source_ip_cidr": ["224.0.0.0/3", "ff00::/8"], "action": "reject"},
        {"protocol": "dns", "action": "hijack-dns"}
    ]);
    if per_app {
        let rules = route_rules.as_array_mut().unwrap();
        // allow: the listed apps ride the tunnel. block: the listed apps skip it.
        let target = if apps_only { "proxy" } else { "direct" };
        let (paths, names): (Vec<&String>, Vec<&String>) =
            apps.iter().partition(|a| a.contains('\\') || a.contains('/'));
        // process rules first: a terminal early rule must not swallow them
        if !names.is_empty() {
            rules.insert(0, serde_json::json!({"process_name": names, "outbound": target}));
        }
        if !paths.is_empty() {
            rules.insert(0, serde_json::json!({"process_path": paths, "outbound": target}));
        }
    }
    if voice {
        // Voice rules go on top of whatever routing the session already has,
        // so the normal VPN and the voice helper run in the same tunnel: the
        // voice ports of the Riot processes ride it, the rest of each listed
        // app keeps following the mode's own rules.
        let rules = route_rules.as_array_mut().unwrap();
        let riot = serde_json::json!([
            "VALORANT-Win64-Shipping.exe",
            "VALORANT.exe",
            "RiotClientServices.exe"
        ]);
        rules.insert(
            0,
            serde_json::json!({
                "process_name": riot,
                "domain_suffix": ["vivox.com", "voice.riotgames.com"],
                "outbound": "proxy"
            }),
        );
        rules.insert(
            0,
            serde_json::json!({
                "process_name": riot,
                "port_range": ["8393:8400"],
                "outbound": "proxy"
            }),
        );
        rules.insert(
            0,
            serde_json::json!({
                "process_name": riot,
                "network": "udp",
                "port_range": ["3478:3480"],
                "outbound": "proxy"
            }),
        );
        // Riot publishes the voice media ranges per region: UDP 27016-27024
        // in NA/EU and UDP 54000-54012 in AP/SE. These carry the actual
        // audio. The first version of this feature routed only signaling and
        // STUN, so the media kept taking the direct path and voice stayed
        // bad. They are matched WITHOUT process scoping (the ranges are
        // exclusive to the voice engine, and UDP process matching is the
        // flakier half of sing-box's feature set) and on BOTH sides of the
        // flow, because the published range can show up as either the
        // destination or the client's own bound port.
        for range in ["54000:54012", "27016:27024"] {
            rules.insert(
                0,
                serde_json::json!({"network": "udp", "port_range": [range], "outbound": "proxy"}),
            );
            rules.insert(
                0,
                serde_json::json!({"network": "udp", "source_port_range": [range], "outbound": "proxy"}),
            );
        }
    }
    {
        // IPv6 is captured by the tun (so it cannot leak around the VPN) but
        // never carried: the exit has no usable v6 path, and a new v6 flow
        // sent into it blackholes without any fallback, which is exactly how
        // Discord voice calls and screen shares broke while existing v4 flows
        // kept working. Rejecting v6 makes apps fall back to v4 politely.
        // This must sit above every other rule, voice rules included.
        let rules = route_rules.as_array_mut().unwrap();
        rules.insert(0, serde_json::json!({"ip_version": 6, "action": "reject"}));
    }
    let dns_rules = if voice {
        serde_json::json!([
            {"domain": [host], "server": "direct-dns"},
            // Riot's voice domains resolve through the tunnel: the direct
            // resolver in Egypt is exactly the thing that fails for them.
            {"domain_suffix": ["vivox.com", "voice.riotgames.com"], "server": "proxy-dns"}
        ])
    } else {
        serde_json::json!([{"domain": [host], "server": "direct-dns"}])
    };
    let cfg = serde_json::json!({
        "log": {"level": "warning"},
        "dns": {
            "servers": [
                {"type": "https", "tag": "proxy-dns", "server": PROXY_DOH_IP, "detour": "proxy"},
                {"type": "udp", "tag": "direct-dns", "server": DIRECT_DNS}
            ],
            "rules": dns_rules,
            "final": dns_final,
            "strategy": "ipv4_only"
        },
        "inbounds": [{
            "type": "tun",
            "tag": "tun-in",
            "interface_name": if_name,
            "mtu": 9000,
            "address": [format!("{TUN_IP}/28"), "fdfe:dcba:9876::1/126".to_string()],
            "auto_route": true,
            "strict_route": true,
            "stack": tun_stack,
            "route_exclude_address": excludes
        }],
        "outbounds": [
            {
                "type": "vless",
                "tag": "proxy",
                "server": host,
                "server_port": 443,
                "uuid": uuid,
                "tls": {
                    "enabled": true,
                    "server_name": sni,
                    "insecure": true,
                    "alpn": ["h3", "h2", "http/1.1"],
                    "utls": {"enabled": true, "fingerprint": "random"}
                }
            },
            {"type": "direct", "tag": "direct"}
        ],
        "route": {
            "rules": route_rules,
            "final": route_final,
            "auto_detect_interface": true,
            "default_domain_resolver": "direct-dns"
        }
    });
    let p = tun_config_path();
    std::fs::write(
        &p,
        serde_json::to_string_pretty(&cfg).map_err(|e| format!("config: {e}"))?,
    )
    .map_err(|e| format!("write config: {e}"))?;
    // Remember which adapter belongs to this session. The traffic counter has
    // to match it by its exact name: other products' wintun adapters and
    // ghosts of force-killed runs share the vague words in their description.
    let _ = std::fs::write(p.with_file_name("tun-ifname.txt"), &if_name);
    Ok(p)
}

/// Validate the config before routing a single packet.
pub fn check_config() -> Result<(), String> {
    let o = run_hidden(
        &singbox_path().to_string_lossy(),
        &["check", "-c", &tun_config_path().to_string_lossy()],
    )?;
    if o.status.success() {
        Ok(())
    } else {
        let err = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
        let tail: Vec<&str> = err.lines().collect();
        let tail = tail[tail.len().saturating_sub(4)..].join(" | ");
        Err(format!("bad tunnel config: {}", tail.trim()))
    }
}

/// Spawn the engine hidden, stderr APPENDED to a log file (with a run
/// marker). The log rotates: past 256KB it restarts, so reads stay cheap
/// and the file can't grow forever.
/// Returns the child handle (caller owns it).
pub fn spawn_engine() -> Result<std::process::Child, String> {
    use std::io::Write;
    let path = engine_log_path();
    // rotate: a stale multi-MB log makes every tail read + failure message slow
    if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 256 * 1024 {
        let _ = std::fs::write(&path, "=== rotated (was >256KB) ===\n");
    }
    let mut log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("log: {e}"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(log, "=== run {now} ===");
    let child = cmd_hidden(&singbox_path().to_string_lossy())
        .args(["run", "-c", &tun_config_path().to_string_lossy()])
        .current_dir(engine_dir())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(log)
        .spawn()
        .map_err(|e| format!("start engine: {e}"))?;
    // pid file: lets cleanup kill OUR engine without the slow wmic sweep
    let _ = std::fs::write(engine_dir().join("engine.pid"), child.id().to_string());
    Ok(child)
}

pub fn engine_log_path() -> PathBuf {
    engine_dir().join("singbox.log")
}

/// Last few engine log lines, color codes stripped - for failure messages.
/// Reads only the last 16KB so a big log can't stall the UI.
pub fn engine_log_tail() -> String {
    use std::io::{Read, Seek, SeekFrom};
    let mut t = String::new();
    if let Ok(mut f) = std::fs::File::open(engine_log_path()) {
        let len = f.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = f.seek(SeekFrom::Start(len.saturating_sub(16 * 1024)));
        let _ = f.read_to_string(&mut t);
    }
    let mut plain = String::with_capacity(t.len());
    let mut it = t.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1b}' && it.peek() == Some(&'[') {
            for c2 in it.by_ref() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            plain.push(c);
        }
    }
    let lines: Vec<&str> = plain.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = &lines[lines.len().saturating_sub(3)..];
    tail.join(" | ").chars().take(300).collect()
}

/// Ask the engine to exit on its own (lets it delete its TUN adapter -
/// a force-kill can leave a ghost adapter that blocks the next connect).
pub fn request_graceful_stop(pid: u32) {
    let _ = run_hidden("taskkill", &["/PID", &pid.to_string()]);
}

/// App-side lifecycle line in the same log (spawn/probe/death markers).
pub fn app_log(line: &str) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(engine_log_path())
    {
        let _ = writeln!(f, "app: {line}");
    }
}

/// Reset a wedged wintun driver (ghost adapter names). Harmless otherwise.
pub fn bounce_wintun() {
    let _ = run_hidden("sc", &["stop", "wintun"]);
    std::thread::sleep(std::time::Duration::from_millis(2500));
}

/// Single-instance lock. Returns Some(other_pid) when a LIVE other copy
/// is running (caller must stand down - two copies fight over one tunnel);
/// otherwise claims the lock and returns None. A stale lock (dead PID)
/// is reclaimed.
pub fn claim_instance() -> Option<u32> {
    let p = crate::config::AppConfig::config_dir().join("instance.lock");
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let me = std::process::id();
    if let Ok(txt) = std::fs::read_to_string(&p) {
        if let Ok(pid) = txt.trim().parse::<u32>() {
            if pid != me && process_is_quotacards(pid) {
                return Some(pid);
            }
        }
    }
    let _ = std::fs::write(&p, me.to_string());
    None
}

/// Release our lock (only if we hold it).
pub fn release_instance() {
    let p = crate::config::AppConfig::config_dir().join("instance.lock");
    if let Ok(txt) = std::fs::read_to_string(&p) {
        if txt.trim().parse::<u32>().ok() == Some(std::process::id()) {
            let _ = std::fs::remove_file(&p);
        }
    }
}

fn process_is_quotacards(pid: u32) -> bool {
    let out = match run_hidden("tasklist", &["/FI", &format!("PID eq {pid}")]) {
        Ok(o) => o,
        Err(_) => return false,
    };
    let t = String::from_utf8_lossy(&out.stdout).to_lowercase();
    t.lines().any(|l| {
        l.contains("quotacards")
            && l.split_whitespace().any(|w| w.parse::<u32>().ok() == Some(pid))
    })
}

/// Egress IP with the system proxy BYPASSED - under TUN this must be the
/// server; with no tunnel it is the real IP. Proves full capture.
pub fn egress_ip_direct() -> Result<String, String> {
    let o = run_hidden(
        "curl",
        &[
            "-s", "--max-time", "20", "--noproxy", "*",
            "https://api.ipify.org",
        ],
    )
    .map_err(|e| format!("probe: {e}"))?;
    let ip = String::from_utf8_lossy(&o.stdout).trim().to_string();
    if ip.is_empty() || !ip.bytes().next().is_some_and(|c| c.is_ascii_digit()) {
        return Err("no route (tunnel dead?)".to_string());
    }
    Ok(ip)
}

/// Is any default route still pointing into our TUN interface?
pub fn tun_routes_present() -> bool {
    run_hidden("route", &["print", "-4"])
        .map(|o| {
            let t = String::from_utf8_lossy(&o.stdout);
            t.lines().any(|l| {
                let l = l.trim_start();
                l.starts_with("0.0.0.0") && l.contains(TUN_IP)
            })
        })
        .unwrap_or(false)
}

/// Kill our orphan engine (matched by our config path, never anyone else's)
/// and remove default routes via the TUN interface. `keep` spares one live
/// PID (the just-connected engine - without this the connect handler would
/// hunt down its own child). Safe to call anytime.
pub fn engine_cleanup() {
    engine_cleanup_keep(None);
}

pub fn engine_cleanup_keep(keep: Option<u32>) {
    // fast path: kill OUR engine via the pid file (no wmic - wmic alone
    // can take 2-5s on Win11 and froze the old UI on every disconnect)
    if let Ok(pid_s) = std::fs::read_to_string(engine_dir().join("engine.pid")) {
        if let Ok(pid) = pid_s.trim().parse::<u32>() {
            if Some(pid) != keep && pid != 0 {
                // confirm it's still ours before killing (filtered = fast)
                let ours = std::process::Command::new("tasklist")
                    .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
                    .creation_flags(0x08000000)
                    .output()
                    .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
                    .unwrap_or_default();
                if ours.contains("sing-box") {
                    let _ = run_hidden("taskkill", &["/F", "/PID", &pid.to_string()]);
                }
            }
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    // default route via a dead TUN = no internet: remove (up to 3 tries,
    // one per leftover default entry Windows may hold)
    for _ in 0..3 {
        if !tun_routes_present() {
            break;
        }
        let _ = run_hidden(
            "route",
            &["delete", "0.0.0.0", "mask", "0.0.0.0", TUN_IP],
        );
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    // slow wmic sweep only if something STILL holds the TUN (crash
    // leftovers) - the common stop path returns before this
    if tun_routes_present() {
        engine_orphan_sweep(keep);
    }
}

/// Slow fallback: hunt any sing-box bound to our config path. Only for
/// crash leftovers - never on the hot stop path.
fn engine_orphan_sweep(keep: Option<u32>) {
    if let Ok(o) = run_hidden(
        "wmic",
        &[
            "process", "where", "name='sing-box.exe'", "get",
            "commandline,processid",
        ],
    ) {
        let ours = tun_config_path().to_string_lossy().to_lowercase();
        for line in String::from_utf8_lossy(&o.stdout).lines().skip(1) {
            let low = line.to_lowercase();
            if low.contains("sing-box") && low.contains(&ours) {
                if let Some(pid) = low.split_whitespace().last() {
                    if pid.parse::<u32>().ok() == keep {
                        continue; // that's our live engine, not an orphan
                    }
                    let _ = run_hidden("taskkill", &["/F", "/PID", pid]);
                }
            }
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(300));
    for _ in 0..3 {
        if !tun_routes_present() {
            break;
        }
        let _ = run_hidden(
            "route",
            &["delete", "0.0.0.0", "mask", "0.0.0.0", TUN_IP],
        );
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The three tests rewrite one engine config file; serialize them.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn cfg(mode: &str, apps: &[&str]) -> serde_json::Value {
        let list: Vec<String> = apps.iter().map(|s| s.to_string()).collect();
        let p = write_tun_config(
            "00000000-test",
            crate::config::DEFAULT_HOST,
            "example.com",
            mode,
            &list,
            false,
        )
        .expect("config");
        serde_json::from_str(&std::fs::read_to_string(p).expect("read")).expect("json")
    }

    #[test]
    fn voice_config_routes_only_voice() {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // The voice-only session: no app list, just the helper.
        let list: Vec<String> = vec![];
        let p = write_tun_config(
            "00000000-test",
            crate::config::DEFAULT_HOST,
            "example.com",
            "allow",
            &list,
            true,
        )
        .expect("config");
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(p).expect("read")).expect("json");
        let rules = v["route"]["rules"].as_array().unwrap();
        // IPv6 is rejected above everything: captured so it cannot leak,
        // never carried, so new v6 flows fall back to v4 instead of dying.
        assert_eq!(rules[0]["ip_version"], 6);
        assert_eq!(rules[0]["action"], "reject");
        // the voice port rule rides the tunnel (port_range, not port:
        // sing-box 1.14 accepts ranges only through port_range)
        assert!(rules.iter().any(|r| r["port_range"][0] == "3478:3480" && r["outbound"] == "proxy"));
        // The published voice MEDIA ranges ride the tunnel in both forms:
        // EU voice is UDP 27016-27024, AP/SE is 54000-54012, matched without
        // process scoping and on either side of the flow.
        assert!(rules.iter().any(|r| r["port_range"][0] == "27016:27024" && r["outbound"] == "proxy"));
        assert!(rules.iter().any(|r| r["source_port_range"][0] == "27016:27024" && r["outbound"] == "proxy"));
        assert!(rules.iter().any(|r| r["port_range"][0] == "54000:54012" && r["outbound"] == "proxy"));
        assert!(rules.iter().any(|r| r["source_port_range"][0] == "54000:54012" && r["outbound"] == "proxy"));
        // no catch-all app rule is written for the Riot processes: the game
        // follows route.final, which stays direct so only voice is carried
        assert_eq!(v["route"]["final"], "direct");
        // no generic Riot rule exists either: without port_range or
        // domain_suffix the only rules that could proxy the game are absent
        assert!(!rules.iter().any(|r| {
            r["outbound"] == "proxy"
                && r.get("port_range").is_none()
                && r.get("domain_suffix").is_none()
                && r["process_name"].as_array().map_or(false, |a| a.len() == 3)
        }));
        // vivox resolves through the tunnel, not the local resolver
        let dns = v["dns"]["rules"].as_array().unwrap();
        assert!(dns.iter().any(|r| r["domain_suffix"][0] == "vivox.com"));
        // The engine's own decoder is the only authority on the grammar: a
        // rule shape it rejects kills the session at connect time. This is
        // exactly the check that was missing when "port" was used for ranges.
        if engine_dir().join("sing-box.exe").exists() {
            check_config().expect("engine accepts the voice config");
        }
    }

    #[test]
    fn voice_merges_with_a_normal_session() {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Normal per-app session (picked apps) with the voice helper on: the
        // caller's app rule and the voice rules must coexist in one config.
        let v = cfg_voice("allow", &["chrome.exe"], true);
        let rules = v["route"]["rules"].as_array().unwrap();
        // voice rules on top, under the v6 reject
        assert_eq!(rules[0]["ip_version"], 6);
        assert!(rules.iter().any(|r| r["port_range"][0] == "3478:3480"));
        // the normal app rule is still present
        assert!(rules.iter().any(|r| {
            r["process_name"].as_array().map_or(false, |a| {
                a.iter().any(|x| x.as_str() == Some("chrome.exe"))
            })
        }));
        // allow-mode finals stay: everything else direct
        assert_eq!(v["route"]["final"], "direct");
        // whole-device session plus the helper: everything rides the tunnel
        let v2 = cfg_voice("all", &[], true);
        assert_eq!(v2["route"]["final"], "proxy");
        assert!(v2["route"]["rules"].as_array().unwrap().iter().any(|r| r["port_range"][0] == "3478:3480"));
        if engine_dir().join("sing-box.exe").exists() {
            check_config().expect("engine accepts the merged config");
        }
    }

    fn cfg_voice(mode: &str, apps: &[&str], voice: bool) -> serde_json::Value {
        let list: Vec<String> = apps.iter().map(|s| s.to_string()).collect();
        let p = write_tun_config(
            "00000000-test",
            crate::config::DEFAULT_HOST,
            "example.com",
            mode,
            &list,
            voice,
        )
        .expect("config");
        serde_json::from_str(&std::fs::read_to_string(p).expect("read")).expect("json")
    }

    #[test]
    fn allow_mode_sends_picked_apps_through_the_proxy() {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let v = cfg("allow", &["chrome.exe"]);
        let rules = v["route"]["rules"].as_array().unwrap();
        // the IPv6 reject leads, the picked app follows
        assert_eq!(rules[0]["ip_version"], 6);
        assert_eq!(rules[0]["action"], "reject");
        assert!(rules.iter().any(|r| {
            r["outbound"] == "proxy"
                && r["process_name"].as_array().map_or(false, |a| a[0].as_str() == Some("chrome.exe"))
        }));
        assert_eq!(v["route"]["final"], "direct");
        assert_eq!(v["inbounds"][0]["stack"], "gvisor");
    }

    #[test]
    fn block_mode_sends_picked_apps_direct_and_the_rest_through_the_proxy() {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let v = cfg("block", &["chrome.exe", "C:\\Tools\\game.exe"]);
        let rules = v["route"]["rules"].as_array().unwrap();
        // path rule and name rule both target direct, under the v6 reject
        assert_eq!(rules[0]["ip_version"], 6);
        assert!(rules.iter().any(|r| {
            r["outbound"] == "direct"
                && r["process_path"].as_array().map_or(false, |a| a[0].as_str() == Some("C:\\Tools\\game.exe"))
        }));
        assert!(rules.iter().any(|r| {
            r["outbound"] == "direct"
                && r["process_name"].as_array().map_or(false, |a| a[0].as_str() == Some("chrome.exe"))
        }));
        assert_eq!(v["route"]["final"], "proxy");
        assert_eq!(v["inbounds"][0]["stack"], "gvisor");
        // the real engine must accept it (no engine on disk → skip the check)
        if ensure_engine().is_ok() {
            check_config().expect("sing-box accepts the block config");
        }
    }

    #[test]
    fn whole_pc_mode_keeps_the_fast_mixed_stack() {
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let v = cfg("", &[]);
        assert_eq!(v["route"]["final"], "proxy");
        assert_eq!(v["inbounds"][0]["stack"], "mixed");
    }
}
