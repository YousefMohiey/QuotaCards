//! Speed measurement, backend side, same architecture as the desktop.
//!
//! Why it is not done from the webview: a webview can time a request but cannot
//! read a byte of the response, cannot count a single byte of a download, and
//! its upload progress reports bytes handed to the local socket rather than
//! bytes the network carried. Here every request is real, every byte is counted
//! as it arrives, and an upload is timed from the first byte written to the
//! moment the server answers.
//!
//! Transport is plain tokio + rustls with the ring provider and Mozilla's root
//! store, so no build tooling beyond what the Android build already uses.

use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::{client::TlsStream, TlsConnector};

/// What a throughput window produced, plus the ticks inside it so the UI can
/// draw the same live bars the desktop draws.
#[derive(Serialize, Debug, Clone)]
pub struct SpeedOut {
    pub mbps: Option<f64>,
    pub note: String,
    pub samples: Vec<f64>,
    pub bytes: u64,
    pub secs: f64,
}

impl SpeedOut {
    fn none(note: impl Into<String>) -> Self {
        Self { mbps: None, note: note.into(), samples: Vec::new(), bytes: 0, secs: 0.0 }
    }
}

#[derive(Serialize, Debug, Clone)]
pub struct NetInfo {
    pub ip: String,
    pub isp: String,
    pub place: String,
}

fn connector() -> TlsConnector {
    static C: OnceLock<TlsConnector> = OnceLock::new();
    C.get_or_init(|| {
        // rustls 0.23 wants a process provider before a config is built.
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let cfg = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        TlsConnector::from(Arc::new(cfg))
    })
    .clone()
}

async fn connect(host: &str) -> Result<TlsStream<TcpStream>, String> {
    let addr = tokio::time::timeout(Duration::from_secs(8), tokio::net::lookup_host((host, 443)))
        .await
        .map_err(|_| "resolve timeout".to_string())?
        .map_err(|e| format!("resolve: {e}"))?
        .next()
        .ok_or_else(|| "no address".to_string())?;
    let tcp = tokio::time::timeout(Duration::from_secs(8), TcpStream::connect(addr))
        .await
        .map_err(|_| "connect timeout".to_string())?
        .map_err(|e| format!("connect: {e}"))?;
    let _ = tcp.set_nodelay(true);
    let name = ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), connector().connect(name, tcp))
        .await
        .map_err(|_| "tls timeout".to_string())?
        .map_err(|e| format!("tls: {e}"))
}

fn bust(path: &str) -> String {
    let sep = if path.contains('?') { '&' } else { '?' };
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{path}{sep}x={n}")
}

fn mbps(bytes: u64, secs: f64) -> f64 {
    if secs <= 0.0 {
        0.0
    } else {
        bytes as f64 * 8.0 / secs / 1e6
    }
}

/// Bytes for an upload body. Constant bytes can be compressed by a middlebox,
/// which would then measure the compression instead of the link.
fn filler(len: usize, seed: u64) -> Vec<u8> {
    let mut out = vec![0u8; len];
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15 ^ seed;
    for b in out.iter_mut() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *b = (x & 0xFF) as u8;
    }
    out
}

async fn send_get(s: &mut TlsStream<TcpStream>, host: &str, path: &str) -> Result<(), String> {
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: QuotaVPN\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );
    s.write_all(req.as_bytes()).await.map_err(|e| format!("write: {e}"))
}

/// Round trips to one path, in milliseconds. A failed probe stops the series:
/// eight probes against an unreachable host would spend eight connect timeouts
/// before the caller can move on.
pub async fn latency(host: &str, path: &str, probes: u32) -> Vec<f64> {
    let mut out = Vec::new();
    for _ in 0..probes {
        let t0 = Instant::now();
        let mut s = match connect(host).await {
            Ok(s) => s,
            Err(_) => break,
        };
        let ok = match send_get(&mut s, host, &bust(path)).await {
            Ok(()) => {
                let mut buf = [0u8; 512];
                match tokio::time::timeout(Duration::from_secs(6), s.read(&mut buf)).await {
                    Ok(Ok(n)) => n > 0,
                    _ => false,
                }
            }
            Err(_) => false,
        };
        if !ok {
            break;
        }
        out.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    out
}

/// Sequential downloads until the window closes. Bytes are counted as they
/// arrive and the reading is cumulative bytes over elapsed time, which cannot
/// over-read the way a per-interval window can. Ticks every 250ms land in
/// `samples` for the UI.
pub async fn download(host: &str, path: &str, seconds: f64) -> SpeedOut {
    let start = Instant::now();
    let mut bytes: u64 = 0;
    let mut samples: Vec<f64> = Vec::new();
    let mut last_tick = start;
    let mut note = String::from("down: nothing arrived");
    let mut stream = match connect(host).await {
        Ok(s) => s,
        Err(e) => return SpeedOut::none(format!("down: {e}")),
    };
    if let Err(e) = send_get(&mut stream, host, &bust(path)).await {
        return SpeedOut::none(format!("down: {e}"));
    }
    let mut buf = vec![0u8; 64 * 1024];
    while start.elapsed().as_secs_f64() < seconds {
        let next = tokio::time::timeout(Duration::from_secs(3), stream.read(&mut buf)).await;
        match next {
            Err(_) => {
                note = String::from("down: stream stalled");
                break;
            }
            Ok(Err(e)) => {
                note = format!("down: {e}");
                break;
            }
            Ok(Ok(0)) => {
                note = String::from("down: closed early");
                break;
            }
            Ok(Ok(n)) => {
                bytes += n as u64;
                let now = Instant::now();
                if now.duration_since(last_tick) >= Duration::from_millis(250) {
                    samples.push(mbps(bytes, now.duration_since(start).as_secs_f64()));
                    last_tick = now;
                }
            }
        }
    }
    let secs = start.elapsed().as_secs_f64();
    if bytes == 0 {
        return SpeedOut { mbps: None, note, samples, bytes, secs };
    }
    // The last tick of the slice, so a slow slice still draws something.
    samples.push(mbps(bytes, secs.max(0.15)));
    SpeedOut { mbps: Some(mbps(bytes, secs.max(0.15))), note, samples, bytes, secs }
}

/// One POST, timed from the first body byte to the server's reply. Chunks are
/// sequential and the caller drops the first one (it only fills local and proxy
/// buffers, so it reads the buffer, not the link).
pub async fn upload_chunk(host: &str, path: &str, chunk: &[u8]) -> Result<f64, String> {
    let mut s = connect(host).await?;
    let head = format!(
        "POST {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: QuotaVPN\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        chunk.len()
    );
    let t0 = Instant::now();
    s.write_all(head.as_bytes()).await.map_err(|e| format!("write: {e}"))?;
    for part in chunk.chunks(64 * 1024) {
        s.write_all(part).await.map_err(|e| format!("write: {e}"))?;
    }
    s.flush().await.map_err(|e| format!("flush: {e}"))?;
    let mut buf = [0u8; 1024];
    match tokio::time::timeout(Duration::from_secs(12), s.read(&mut buf)).await {
        Ok(Ok(0)) | Err(_) => return Err("up: no reply".into()),
        Ok(Ok(_)) => {}
        Ok(Err(e)) => return Err(format!("up: {e}")),
    }
    Ok(mbps(chunk.len() as u64, t0.elapsed().as_secs_f64()))
}

/// Read one whole response body (used by the exit-address lookup).
async fn get_text(host: &str, path: &str) -> Result<String, String> {
    let mut s = connect(host).await?;
    send_get(&mut s, host, path).await?;
    let mut out = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        match tokio::time::timeout(Duration::from_secs(8), s.read(&mut buf)).await {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Ok(n)) => {
                out.extend_from_slice(&buf[..n]);
                if out.len() > 256 * 1024 {
                    break;
                }
            }
            Ok(Err(_)) => break,
        }
    }
    if out.is_empty() {
        return Err("empty".into());
    }
    let text = String::from_utf8_lossy(&out).to_string();
    // Keep the body only; headers carry no JSON.
    Ok(match text.find("\r\n\r\n") {
        Some(i) => text[i + 4..].to_string(),
        None => text,
    })
}

fn join_place(city: Option<&str>, country: Option<&str>) -> String {
    match (city.filter(|s| !s.is_empty()), country.filter(|s| !s.is_empty())) {
        (Some(c), Some(k)) => format!("{c}, {k}"),
        (Some(c), None) => c.to_string(),
        (None, Some(k)) => k.to_string(),
        _ => String::new(),
    }
}

/// Where this device comes out on the internet: the exit ISP and address the
/// speed test will be measured from. Three sources, first answer wins.
pub async fn net_info() -> Option<NetInfo> {
    if let Ok(body) = get_text("ipwho.is", "/").await {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
            if v.get("success").and_then(|x| x.as_bool()) != Some(false) {
                if let Some(ip) = v.get("ip").and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
                    let isp = v
                        .pointer("/connection/isp")
                        .and_then(|x| x.as_str())
                        .or_else(|| v.pointer("/connection/org").and_then(|x| x.as_str()))
                        .unwrap_or("")
                        .to_string();
                    let place = join_place(
                        v.get("city").and_then(|x| x.as_str()),
                        v.get("country").and_then(|x| x.as_str()),
                    );
                    return Some(NetInfo { ip: ip.to_string(), isp, place });
                }
            }
        }
    }
    if let Ok(body) = get_text("ipapi.co", "/json/").await {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(ip) = v.get("ip").and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
                let isp = v.get("org").and_then(|x| x.as_str()).unwrap_or("").to_string();
                let place = join_place(
                    v.get("city").and_then(|x| x.as_str()),
                    v.get("country_name").and_then(|x| x.as_str()),
                );
                return Some(NetInfo { ip: ip.to_string(), isp, place });
            }
        }
    }
    // Last resort: Cloudflare's trace endpoint on the same host the public
    // speed reference uses. No provider, but an address beats a dash.
    if let Ok(body) = get_text("cloudflare.com", "/cdn-cgi/trace").await {
        let ip = body
            .lines()
            .find_map(|l| l.strip_prefix("ip="))
            .unwrap_or("")
            .trim()
            .to_string();
        if !ip.is_empty() {
            return Some(NetInfo { ip, isp: String::new(), place: String::new() });
        }
    }
    None
}

/// N chunks of `chunk_mb` megabytes, sequentially, inside `window` seconds.
/// The per-chunk rates come back so the caller can keep the same median rule
/// the desktop uses.
pub async fn upload(host: &str, path: &str, window: f64, chunk_mb: usize, seed: u64) -> SpeedOut {
    let start = Instant::now();
    let chunk = filler(chunk_mb * 1024 * 1024, seed);
    let mut rates: Vec<f64> = Vec::new();
    let mut note = String::from("up: no chunk completed");
    while start.elapsed().as_secs_f64() < window {
        match upload_chunk(host, &bust(path), &chunk).await {
            Ok(v) => rates.push(v),
            Err(e) => {
                note = e;
                break;
            }
        }
    }
    if rates.is_empty() {
        return SpeedOut::none(note);
    }
    // First chunk only fills buffers: drop it before reading the shape.
    let body: Vec<f64> = if rates.len() > 1 { rates[1..].to_vec() } else { rates.clone() };
    let mut sorted = body.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let v = sorted[sorted.len() / 2];
    SpeedOut { mbps: Some(v), note, samples: body, bytes: (chunk_mb as u64) * 1024 * 1024, secs: start.elapsed().as_secs_f64() }
}
