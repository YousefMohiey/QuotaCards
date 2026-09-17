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
/// dropped, so an empty Vec means the endpoint is unusable.
pub async fn latency(client: &Client, url: &str, probes: u32) -> Vec<f64> {
    let mut out = Vec::new();
    for _ in 0..probes {
        let t0 = Instant::now();
        if let Ok(resp) = client.get(bust(url)).send().await {
            let _ = resp.bytes().await;
            out.push(t0.elapsed().as_secs_f64() * 1000.0);
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
) -> Option<f64> {
    if urls.is_empty() {
        return None;
    }
    let start = Instant::now();
    let mut bytes: u64 = 0;
    let mut last_tick = start;
    let mut i = 0usize;
    while start.elapsed().as_secs_f64() < window {
        let url = bust(&urls[i % urls.len()]);
        i += 1;
        let mut resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => break,
        };
        if !resp.status().is_success() {
            break;
        }
        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
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
                Err(_) => break,
            }
        }
    }
    let secs = start.elapsed().as_secs_f64();
    if bytes == 0 || secs < 0.5 {
        return None;
    }
    Some(mbps(bytes, secs))
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
) -> Option<f64> {
    let body = filler(chunk_mb * 1024 * 1024);
    let start = Instant::now();
    let mut samples: Vec<f64> = Vec::new();
    while start.elapsed().as_secs_f64() < window {
        let t0 = Instant::now();
        let resp = client.post(bust(url)).body(body.clone()).send().await;
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
            _ => break,
        }
    }
    let real: Vec<f64> = samples.into_iter().filter(|v| *v > 0.0).collect();
    if real.is_empty() {
        return None;
    }
    let mut sorted = real;
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Some(sorted[sorted.len() / 2])
}
