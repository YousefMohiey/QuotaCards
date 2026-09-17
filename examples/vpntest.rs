//! TUN flow test (real code, real server). Needs admin for the TUN adapter:
//! re-launches itself elevated with a UAC prompt if started unelevated.
//! UUID read from %TEMP%/vpntest_uuid.txt (pre-added on the server).
//! Env: APPS="curl.exe,chrome.exe" for per-app mode (empty = whole PC),
//!   EXPECT=server|direct (which egress the probe should see).
use quotacards::vpn;

fn main() {
    if !vpn::is_elevated() {
        println!("not elevated — relaunching with UAC prompt…");
        let me = std::env::current_exe().unwrap();
        let st = std::process::Command::new("powershell")
            .args([
                "-c",
                &format!(
                    "Start-Process '{}' -Verb RunAs -Wait",
                    me.to_string_lossy()
                ),
            ])
            .status()
            .unwrap();
        println!("elevated run exit: {st}");
        return;
    }
    let uuid = std::fs::read_to_string(std::env::temp_dir().join("vpntest_uuid.txt"))
        .unwrap()
        .trim()
        .to_string();
    let host = quotacards::config::DEFAULT_HOST;
    let apps: Vec<String> = std::env::var("APPS")
        .unwrap_or_default()
        .split([',', ';'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let expect = std::env::var("EXPECT").unwrap_or_else(|_| "server".to_string());
    // MODE=allow|block picks the per-app direction; default keeps old behavior.
    let mode = std::env::var("MODE").unwrap_or_else(|_| {
        if apps.is_empty() { String::new() } else { "allow".to_string() }
    });
    // expected egress = whatever the server domain resolves to right now
    let want: Vec<String> = vpn::resolve_server_ips(host).unwrap();
    println!("server resolves to: {want:?}");
    println!("mode={mode:?} apps={apps:?} expect={expect}");
    println!("engine: {}", vpn::ensure_engine().unwrap());
    let p = vpn::write_tun_config(&uuid, host, "epicgames.com", &mode, &apps, false).unwrap();
    println!("config: {p:?}");
    vpn::check_config().unwrap();
    println!("config check OK");
    let mut child = vpn::spawn_engine().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(4000));
    match child.try_wait().unwrap() {
        Some(st) => {
            println!("EARLY EXIT {st}");
            std::process::exit(1);
        }
        None => println!("engine alive"),
    }
    // bypass-proof probe: ignores any proxy env
    let ip = vpn::egress_ip_direct().unwrap();
    println!("EGRESS_IP={ip}");
    let _ = child.kill();
    let _ = child.wait();
    vpn::engine_cleanup();
    println!("routes via TUN left: {}", vpn::tun_routes_present());
    let via_server = want.iter().any(|c| c.starts_with(&ip));
    let ok = match expect.as_str() {
        "server" => via_server,
        "direct" => !via_server,
        _ => true,
    };
    if !ok {
        println!("ROUTING MISMATCH (expected {expect}, server={want:?})");
        std::process::exit(1);
    }
    println!("DONE — routing as expected ({expect})");
}
