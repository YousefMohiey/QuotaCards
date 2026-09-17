//! Manual check for the bundled Ookla CLI path: fetches the binary if needed,
//! runs one test, prints the live progress and the parsed result exactly as
//! the app will read it.
//!
//!   cargo run --release --bin clitest

use std::sync::Arc;

use quotacards_desktop::ookla;

fn main() {
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

    let res = ookla::run(&exe, on_phase, on_tick);
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
