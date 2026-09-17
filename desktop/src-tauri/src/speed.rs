//! Speed measurement, backend-side.
//!
//! Two reasons this lives in Rust and not the webview: test servers do not
//! send CORS headers (the webview can time a request but cannot read it, and
//! cannot count a single byte), and `xhr.upload` progress reports bytes handed
//! to the local socket, not bytes the network carried, which reads a fast
//! upload as a much faster one. Here every request is real, every byte is
//! counted after it arrives, and an upload chunk is timed to the server's ack.

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::Serialize;

/// What a throughput measurement produced, plus a short human-readable reason
/// when it produced nothing. The reason is shown in the UI and appended to the
/// debug log, so a silent failure stops being silent.
#[derive(Serialize, Debug)]
pub struct SpeedOut {
    pub mbps: Option<f64>,
    pub note: String,
}

impl SpeedOut {
    pub fn ok(mbps: f64) -> Self {
        Self { mbps: Some(mbps), note: String::new() }
    }
    pub fn none(note: impl Into<String>) -> Self {
        Self { mbps: None, note: note.into() }
    }
}

/// Append one line to the speed debug log (%APPDATA%/quotacards/speed-debug.log).
/// Capped so it can never grow without bound.
pub fn note(line: &str) {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let dir = std::path::PathBuf::from(base).join("quotacards");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("speed-debug.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 64 * 1024 {
            let _ = std::fs::remove_file(&path);
        }
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let _ = writeln!(f, "{stamp} {line}");
    }
}

/// Random-ish bytes for upload bodies. Constant bytes can be compressed by a
/// middlebox and would then measure the compression, not the link.
fn filler(len: usize) -> Vec<u8> {
    let mut out = vec![0u8; len];
    let mut x: u64 = 0x9E3779B97F4A7C15;
    for b in out.iter_mut() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *b = (x & 0xFF) as u8;
    }
    out
}

fn bust(url: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{url}{sep}x={n}")
}

fn mbps(bytes: u64, secs: f64) -> f64 {
    if secs <= 0.0 {
        0.0
    } else {
        bytes as f64 * 8.0 / secs / 1e6
    }
}

/// Round trips to `url`, one per probe, in milliseconds. Failed probes are
/// dropped, so an empty Vec means the endpoint is unusable. A failing host
/// stops the series: eight probes against an unreachable server would spend
/// eight connect timeouts before the caller can move on.
pub async fn latency(client: &Client, url: &str, probes: u32) -> Vec<f64> {
    let mut out = Vec::new();
    for _ in 0..probes {
        let t0 = Instant::now();
        match client.get(bust(url)).send().await {
            Ok(resp) => {
                let _ = resp.bytes().await;
                out.push(t0.elapsed().as_secs_f64() * 1000.0);
            }
            Err(_) => break,
        }
    }
    out
}

/// Sequential downloads from `urls` (cycled, cache-busted) until the window
/// closes. Returns the average over the whole window: cumulative bytes against
/// elapsed time, which cannot over-read the way a per-interval window does.
pub async fn download(
    client: &Client,
    urls: &[String],
    window: f64,
    mut tick: impl FnMut(f64),
) -> SpeedOut {
    if urls.is_empty() {
        return SpeedOut::none("down: no url");
    }
    note(&format!("down start {:.0}s {}", window, urls[0]));
    let start = Instant::now();
    let mut bytes: u64 = 0;
    let mut last_tick = start;
    let mut i = 0usize;
    let mut empties = 0usize;
    let mut last_note = String::from("down: nothing arrived");
    while start.elapsed().as_secs_f64() < window {
        let url = bust(&urls[i % urls.len()]);
        i += 1;
        let mut resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_note = format!("down: request failed: {}", short_err(&e));
                break;
            }
        };
        if !resp.status().is_success() {
            last_note = format!("down: http {}", resp.status().as_u16());
            break;
        }
        let mut got_any = false;
        loop {
            // A stream that goes quiet for three seconds is dead, not slow: a
            // stalled read must not hang the phase forever behind the window
            // check.
            let next = match tokio::time::timeout(Duration::from_secs(3), resp.chunk()).await {
                Ok(r) => r,
                Err(_) => {
                    last_note = String::from("down: stream stalled");
                    break;
                }
            };
            match next {
                Ok(Some(chunk)) => {
                    got_any = true;
                    bytes += chunk.len() as u64;
                    let now = Instant::now();
                    if now.duration_since(last_tick) >= Duration::from_millis(250) {
                        tick(mbps(bytes, start.elapsed().as_secs_f64()));
                        last_tick = now;
                    }
                    if start.elapsed().as_secs_f64() >= window {
                        break;
                    }
                }
                Ok(None) => break, // file finished, move to the next request
                Err(e) => {
                    last_note = format!("down: stream error: {}", short_err(&e));
                    break;
                }
            }
        }
        if !got_any {
            // Some servers answer 200 with an empty body for a file they do
            // not carry. Try the next URL in the cycle instead of giving up;
            // six empties in a row means the host has nothing to serve.
            empties += 1;
            last_note = String::from("down: empty response");
            if empties >= 6 {
                break;
            }
        }
    }
    let secs = start.elapsed().as_secs_f64();
    if bytes == 0 {
        note(&format!("down end: {last_note}"));
        return SpeedOut::none(last_note);
    }
    let v = mbps(bytes, secs.max(0.25));
    note(&format!("down end: {:.1} Mbps ({} bytes in {:.1}s)", v, bytes, secs));
    SpeedOut::ok(v)
}

/// Short form of a reqwest error: the class matters, the full chain does not.
fn short_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timeout".into()
    } else if e.is_connect() {
        "connect".into()
    } else if e.is_decode() {
        "decode".into()
    } else {
        e.to_string().chars().take(80).collect()
    }
}

/// Sequential fixed-size POSTs, each timed from send to ack. The first chunk
/// only fills local and proxy buffers, so it is dropped; the median of the
/// rest is the reading.
pub async fn upload(
    client: &Client,
    url: &str,
    window: f64,
    chunk_mb: usize,
    mut tick: impl FnMut(f64),
) -> SpeedOut {
    note(&format!("up start {:.0}s {}MB {}", window, chunk_mb, url));
    let body = filler(chunk_mb * 1024 * 1024);
    let start = Instant::now();
    let mut samples: Vec<f64> = Vec::new();
    let mut last_note = String::from("up: no chunk completed");
    while start.elapsed().as_secs_f64() < window {
        let t0 = Instant::now();
        // Same rule as the download: a POST that neither completes nor errors
        // within ten seconds is a stall, and the phase must move on.
        let sent = tokio::time::timeout(
            Duration::from_secs(10),
            client.post(bust(url)).body(body.clone()).send(),
        )
        .await;
        let resp = match sent {
            Ok(r) => r,
            Err(_) => {
                last_note = String::from("up: send stalled");
                break;
            }
        };
        let secs = t0.elapsed().as_secs_f64();
        match resp {
            Ok(r) if r.status().is_success() => {
                let _ = r.bytes().await;
                if !samples.is_empty() {
                    // Past the first chunk, so buffers are already warm.
                    let v = mbps(body.len() as u64, secs);
                    tick(v);
                    samples.push(v);
                } else {
                    samples.push(0.0); // placeholder so the next chunk counts
                }
            }
            Ok(r) => {
                last_note = format!("up: http {}", r.status().as_u16());
                break;
            }
            Err(e) => {
                last_note = format!("up: request failed: {}", short_err(&e));
                break;
            }
        }
    }
    let real: Vec<f64> = samples.into_iter().filter(|v| *v > 0.0).collect();
    if real.is_empty() {
        note(&format!("up end: {last_note}"));
        return SpeedOut::none(last_note);
    }
    let mut sorted = real;
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let v = sorted[sorted.len() / 2];
    note(&format!("up end: {:.1} Mbps ({} chunks)", v, sorted.len()));
    SpeedOut::ok(v)
}
