//! Manual check for the speed measurement: runs the shipping code against a
//! real test server and prints what it measures. Not part of the app.
//!
//!   cargo run --release --bin spdtest [base-url]
//!
//! Default base is an Egyptian speedtest.net server. Pass any server's
//! /speedtest base to check another one.

use quotacards_desktop::speed;

fn main() {
    let base = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "http://sp40.etisalatdata.net:8080/speedtest".to_string());

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(6))
        .user_agent("QuotaCards spdtest")
        .build()
        .expect("client");

    println!("base: {base}");
    tauri::async_runtime::block_on(async {
        let ping = speed::latency(&client, &format!("{base}/latency.txt"), 5).await;
        println!("ping ms: {:?}", ping);

        let down = speed::download(
            &client,
            &[format!("{base}/random2000x2000.jpg")],
            8.0,
            |v| print!("\r  down tick {:7.1} Mbps", v),
        )
        .await;
        println!("\ndown: {down:?} Mbps");

        let up = speed::upload(
            &client,
            &format!("{base}/upload.php"),
            8.0,
            2,
            |v| print!("\r  up tick   {:7.1} Mbps", v),
        )
        .await;
        println!("\nup: {up:?} Mbps");
    });
}
