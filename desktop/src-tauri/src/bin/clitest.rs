//! Manual check for the bundled Ookla CLI path: fetches the binary if needed,
//! runs one test, prints the live progress and the parsed result exactly as
//! the app will read it.
//!
//!   cargo run --release --bin clitest

use std::sync::{Arc, Mutex};

use quotacards_desktop::ookla;

fn main() {
    if std::env::args().any(|a| a == "--selftest") {
        selftest();
        return;
    }
    let exe = match tauri::async_runtime::block_on(ookla::ensure_binary()) {
        Some(p) => p,
        None => {
            println!("ensure_binary returned None");
            std::process::exit(1);
        }
    };
    println!("binary: {}", exe.display());

    let on_phase: Arc<dyn Fn(&str) + Send + Sync> = Arc::new(|p: &str| {
        println!("  phase: {p}");
    });
    let on_tick: Arc<dyn Fn(f64) + Send + Sync> = Arc::new(|v: f64| {
        print!("\r  tick {v:8.2} Mbps");
        use std::io::Write;
        let _ = std::io::stdout().flush();
    });
    let on_result: Arc<dyn Fn(serde_json::Value) + Send + Sync> =
        Arc::new(|j: serde_json::Value| {
            println!("\r  result: {j}");
        });

    let res = ookla::run(&exe, on_phase, on_tick, on_result);
    println!();
    match res {
        Some(r) => {
            println!("parsed:");
            println!("  ping       {:?} ms (jitter {:?})", r.ping_ms, r.jitter_ms);
            println!("  down       {:?} Mbps", r.down_mbps);
            println!("  up         {:?} Mbps", r.up_mbps);
            println!("  loss       {:?} %", r.packet_loss);
            println!("  server     {:?} / {:?} / {:?}", r.server_name, r.server_location, r.server_country);
            println!("  host       {:?}", r.server_host);
            println!("  isp        {:?}", r.isp);
            println!("  result url {:?}", r.result_url);
        }
        None => println!("run returned None"),
    }
}

/// Parser contract, checked without the network: one phase callback per
/// change (not per progress line) and values streaming as they finalize.
fn selftest() {
    let phases = Arc::new(Mutex::new(Vec::<String>::new()));
    let ticks = Arc::new(Mutex::new(Vec::<f64>::new()));
    let results = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let p2 = Arc::clone(&phases);
    let on_phase: Arc<dyn Fn(&str) + Send + Sync> =
        Arc::new(move |p: &str| p2.lock().unwrap().push(p.to_string()));
    let t2 = Arc::clone(&ticks);
    let on_tick: Arc<dyn Fn(f64) + Send + Sync> =
        Arc::new(move |v: f64| t2.lock().unwrap().push(v));
    let r2 = Arc::clone(&results);
    let on_result: Arc<dyn Fn(serde_json::Value) + Send + Sync> =
        Arc::new(move |j: serde_json::Value| r2.lock().unwrap().push(j));

    let mut em = ookla::Emitter::new();
    let mut pars = ookla::Parsed::default();
    let mut push_line = |line: &str| {
        let mut evs: Vec<ookla::Ev> = Vec::new();
        pars.feed(line, &mut evs);
        for ev in evs {
            em.handle(ev, &on_phase, &on_tick, &on_result);
        }
    };
    push_line("Selecting best server based on latency...");
    push_line("Download: 12.34 Mbps [=    ] 10%");
    push_line("Download: 45.67 Mbps [=====] 50%");
    push_line("Download: 59.80 Mbps (data used: 52.3 MB)");
    push_line("Upload: 8.90 Mbps [==   ] 20%");
    push_line("Upload: 28.30 Mbps (data used: 15.1 MB)");
    push_line("Idle Latency: 5.41 ms (jitter: 0.29ms, low: 5.2ms, high: 5.8ms)");

    let ph = phases.lock().unwrap().clone();
    assert_eq!(
        ph,
        vec!["select", "download", "upload"],
        "phase must be announced once per change, not per progress line"
    );
    assert_eq!(
        ticks.lock().unwrap().len(),
        3,
        "two download samples and one upload sample tick through"
    );
    let rs = results.lock().unwrap().clone();
    assert!(rs.iter().any(|j| j["down"] == 59.8), "download streams at phase end");
    assert!(rs.iter().any(|j| j["up"] == 28.3), "upload streams at phase end");
    assert!(
        rs.iter().any(|j| j["ping"] == 5.41 && j["jitter"] == 0.29),
        "idle latency streams when measured"
    );
    println!("selftest OK: phases once per change, values stream mid-run");
}
