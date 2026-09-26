//! Speed measurement, backend side, the desktop's architecture.
//!
//! Why it is not done from the webview: a webview can time a request but cannot
//! read a byte of the response, cannot count a single byte of a download, and
//! its upload progress reports bytes handed to the local socket rather than
//! bytes the network carried. Here every request is real, every byte is counted
//! as it arrives, and an upload is timed from the first byte written to the
//! moment the server answers.
//!
//! The target is a full URL, because the public test servers are not all HTTPS
//! on 443: speedtest.net's own servers answer on plain HTTP port 8080, and the
//! LibreSpeed pool is HTTPS. Both are ordinary targets here.
//!
//! Transport is tokio + rustls with the ring provider and Mozilla's root store,
//! so nothing beyond what the Android build already uses is required.

use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, RootCertStore};
use tokio_rustls::{client::TlsStream, TlsConnector};

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

/// A parsed absolute URL: what to dial and what to ask for.
struct Target {
    host: String,
    port: u16,
    tls: bool,
    path: String,
}

fn parse(url: &str) -> Result<Target, String> {
    let (scheme, rest) = match url.split_once("://") {
        Some((s, r)) => (s, r),
        None => ("https", url),
    };
    let tls = !scheme.eq_ignore_ascii_case("http");
    let default_port = if tls { 443u16 } else { 80u16 };
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            (h.to_string(), p.parse::<u16>().unwrap_or(default_port))
        }
        _ => (authority.to_string(), default_port),
    };
    if host.is_empty() {
        return Err("bad url".into());
    }
    Ok(Target { host, port, tls, path: path.to_string() })
}

/// The user agent every request carries: the same string the desktop sends.
/// The public test servers answer a browser and stall or 500 anything else.
fn host_header(t: &Target) -> String {
    let standard = (t.tls && t.port == 443) || (!t.tls && t.port == 80);
    if standard {
        t.host.clone()
    } else {
        format!("{}:{}", t.host, t.port)
    }
}

fn connector() -> TlsConnector {
    static C: OnceLock<TlsConnector> = OnceLock::new();
    C.get_or_init(|| {
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

enum Conn {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

impl Conn {
    async fn write(&mut self, buf: &[u8]) -> Result<(), String> {
        match self {
            Conn::Plain(s) => s.write_all(buf).await.map_err(|e| e.to_string()),
            Conn::Tls(s) => s.write_all(buf).await.map_err(|e| e.to_string()),
        }
    }
    async fn read(&mut self, buf: &mut [u8]) -> Result<usize, String> {
        match self {
            Conn::Plain(s) => s.read(buf).await.map_err(|e| e.to_string()),
            Conn::Tls(s) => s.read(buf).await.map_err(|e| e.to_string()),
        }
    }
    async fn flush(&mut self) -> Result<(), String> {
        match self {
            Conn::Plain(s) => s.flush().await.map_err(|e| e.to_string()),
            Conn::Tls(s) => s.flush().await.map_err(|e| e.to_string()),
        }
    }
}

async fn connect(url: &str) -> Result<(Conn, Target), String> {
    let t = parse(url)?;
    let addr = tokio::time::timeout(
        Duration::from_secs(8),
        tokio::net::lookup_host((t.host.as_str(), t.port)),
    )
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
    if !t.tls {
        return Ok((Conn::Plain(tcp), t));
    }
    let name = ServerName::try_from(t.host.clone()).map_err(|e| e.to_string())?;
    let stream = tokio::time::timeout(Duration::from_secs(10), connector().connect(name, tcp))
        .await
        .map_err(|_| "tls timeout".to_string())?
        .map_err(|e| format!("tls: {e}"))?;
    Ok((Conn::Tls(Box::new(stream)), t))
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

/// One request, response body read to the end. Chunked answers are unfolded so
/// callers can parse what the server actually said.
async fn fetch(url: &str, timeout: u64) -> Result<String, String> {
    let (mut c, t) = connect(url).await?;
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        t.path,
        host_header(&t)
    );
    c.write(req.as_bytes()).await?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    let deadline = Instant::now() + Duration::from_secs(timeout);
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match tokio::time::timeout(left, c.read(&mut buf)).await {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Ok(n)) => {
                raw.extend_from_slice(&buf[..n]);
                if raw.len() > 2 * 1024 * 1024 {
                    break;
                }
            }
            Ok(Err(_)) => break,
        }
    }
    if raw.is_empty() {
        return Err("empty".into());
    }
    let text = String::from_utf8_lossy(&raw).to_string();
    let Some(head_end) = text.find("\r\n\r\n") else {
        return Ok(text);
    };
    let (head, body) = text.split_at(head_end + 4);
    let chunked = head.to_ascii_lowercase().contains("transfer-encoding: chunked");
    if !chunked {
        return Ok(body.to_string());
    }
    // Strip the chunk framing: hex size line, data, CRLF, until a zero chunk.
    let mut out = String::new();
    let mut rest = body;
    loop {
        let Some(i) = rest.find("\r\n") else { break };
        let size_line = rest[..i].trim();
        let Ok(size) = usize::from_str_radix(size_line.split(';').next().unwrap_or("0").trim(), 16)
        else {
            break;
        };
        if size == 0 {
            break;
        }
        let start = i + 2;
        if rest.len() < start + size {
            out.push_str(&rest[start..]);
            break;
        }
        out.push_str(&rest[start..start + size]);
        rest = &rest[start + size..];
        rest = rest.strip_prefix("\r\n").unwrap_or(rest);
    }
    Ok(out)
}

/// A response head is enough to decide: 2xx means the body can be read, 3xx
/// means go to Location. speedtest.net's own servers answer 307 to their
/// production host, which is why a client that ignores redirects measures
/// nothing there while its latency probe still succeeds.
fn split_head(buf: &[u8]) -> Option<(u16, String, usize)> {
    let text = String::from_utf8_lossy(buf);
    let end = text.find("\r\n\r\n")?;
    let head = &text[..end];
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse::<u16>().ok())?;
    let mut location = String::new();
    for l in lines {
        if l.len() > 9 && l[..9].eq_ignore_ascii_case("location:") {
            location = l[9..].trim().to_string();
        }
    }
    Some((status, location, end + 4))
}

fn absolute(base: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_string();
    }
    let t = match parse(base) {
        Ok(t) => t,
        Err(_) => return location.to_string(),
    };
    let scheme = if t.tls { "https" } else { "http" };
    let authority = host_header(&t);
    if location.starts_with('/') {
        format!("{scheme}://{authority}{location}")
    } else {
        format!("{scheme}://{authority}/{location}")
    }
}

/// Opens a GET and follows up to `hops` redirects. Returns the live
/// connection, the target it settled on, and any body bytes already read.
async fn open_get(url: &str, hops: u32) -> Result<(Conn, Target, Vec<u8>), String> {
    let (mut c, t) = connect(url).await?;
    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36\r\nAccept: */*\r\nConnection: close\r\n\r\n",
        t.path,
        host_header(&t)
    );
    c.write(req.as_bytes()).await?;
    let mut buf = vec![0u8; 8192];
    let mut got: Vec<u8> = Vec::new();
    loop {
        match tokio::time::timeout(Duration::from_secs(8), c.read(&mut buf)).await {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Err(e)) => return Err(format!("read: {e}")),
            Ok(Ok(n)) => {
                got.extend_from_slice(&buf[..n]);
                if let Some((status, location, head_len)) = split_head(&got) {
                    if (300..400).contains(&status) {
                        if hops == 0 {
                            return Err(format!("redirect loop ({status})"));
                        }
                        if location.is_empty() {
                            return Err(format!("redirect without location ({status})"));
                        }
                        let next = absolute(url, &location);
                        drop(c);
                        return Box::pin(open_get(&next, hops - 1)).await;
                    }
                    let body = got[head_len..].to_vec();
                    return Ok((c, t, body));
                }
            }
        }
    }
    Ok((c, t, got))
}

/// Round trips to one URL, in milliseconds. A failed probe stops the series:
/// eight probes against an unreachable host would spend eight connect timeouts
/// before the caller can move on.
pub async fn latency(url: &str, probes: u32) -> Vec<f64> {
    let mut out = Vec::new();
    for _ in 0..probes {
        let t0 = Instant::now();
        // The whole chain counts: the public servers redirect to their real
        // host, and a reading that skipped that hop would flatter them.
        let ok = match open_get(&bust_url(url), 3).await {
            Ok((_c, _t, _bytes)) => true,
            Err(_) => false,
        };
        if !ok {
            break;
        }
        out.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    out
}

fn bust_url(url: &str) -> String {
    match url.split_once('#') {
        Some((base, _)) => bust(base),
        None => bust(url),
    }
}

/// Streams downloads until the window closes, cycling the URLs given (the
/// desktop's rule: not every server carries the big file, and some answer an
/// empty 200 for it). Bytes are counted as they arrive and the reading is
/// cumulative bytes over elapsed time, which cannot over-read the way a
/// per-interval window can. Ticks every 250ms land in `samples`.
pub async fn download(urls: &[String], seconds: f64) -> SpeedOut {
    if urls.is_empty() {
        return SpeedOut::none("down: no url");
    }
    let start = Instant::now();
    let mut bytes: u64 = 0;
    let mut samples: Vec<f64> = Vec::new();
    let mut last_tick = start;
    let mut note = String::from("down: nothing arrived");
    let mut i = 0usize;
    let mut empties = 0usize;

    while start.elapsed().as_secs_f64() < seconds {
        let url = bust(&urls[i % urls.len()]);
        i += 1;
        let (mut c, _t, head_body) = match open_get(&url, 3).await {
            Ok(x) => x,
            Err(e) => {
                note = format!("down: {e}");
                break;
            }
        };
        let mut got_any = false;
        let mut buf = vec![0u8; 64 * 1024];
        if !head_body.is_empty() {
            got_any = true;
            bytes += head_body.len() as u64;
        }
        loop {
            if start.elapsed().as_secs_f64() >= seconds {
                break;
            }
            match tokio::time::timeout(Duration::from_secs(3), c.read(&mut buf)).await {
                Err(_) => {
                    note = String::from("down: stream stalled");
                    break;
                }
                Ok(Err(e)) => {
                    note = format!("down: {e}");
                    break;
                }
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    got_any = true;
                    bytes += n as u64;
                    let now = Instant::now();
                    if now.duration_since(last_tick) >= Duration::from_millis(150) {
                        samples.push(mbps(bytes, now.duration_since(start).as_secs_f64()));
                        last_tick = now;
                    }
                }
            }
        }
        if !got_any {
            empties += 1;
            note = String::from("down: empty response");
            if empties >= 6 {
                break;
            }
        }
    }
    let secs = start.elapsed().as_secs_f64();
    if bytes == 0 {
        return SpeedOut { mbps: None, note, samples, bytes, secs };
    }
    samples.push(mbps(bytes, secs.max(0.15)));
    SpeedOut { mbps: Some(mbps(bytes, secs.max(0.15))), note, samples, bytes, secs }
}

/// One POST, timed from the first body byte to the server's reply. Chunks are
/// sequential and the caller drops the first one (it only fills local and proxy
/// buffers, so it reads the buffer, not the link).
pub async fn upload_chunk(url: &str, chunk: &[u8]) -> Result<f64, String> {
    let t0 = Instant::now();
    let mut target_url = url.to_string();
    for hop in 0..4 {
        let (mut c, t) = connect(&target_url).await?;
        let head = format!(
            "POST {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            t.path,
            host_header(&t),
            chunk.len()
        );
        if hop > 3 {
            break;
        }
        c.write(head.as_bytes()).await?;
        for part in chunk.chunks(64 * 1024) {
            c.write(part).await?;
        }
        c.flush().await?;
        // Read the head: a redirect means posting the same body again at the
        // real host (the public servers answer 307 from their vanity host).
        let mut buf = vec![0u8; 8192];
        let mut got: Vec<u8> = Vec::new();
        loop {
            match tokio::time::timeout(Duration::from_secs(12), c.read(&mut buf)).await {
                Ok(Ok(0)) | Err(_) => break,
                Ok(Err(e)) => return Err(format!("up: {e}")),
                Ok(Ok(n)) => {
                    got.extend_from_slice(&buf[..n]);
                    if let Some((status, location, _)) = split_head(&got) {
                        if (300..400).contains(&status) {
                            if location.is_empty() {
                                return Err(format!("up: redirect without location ({status})"));
                            }
                            target_url = absolute(&target_url, &location);
                            got.clear();
                            break;
                        }
                        return Ok(mbps(chunk.len() as u64, t0.elapsed().as_secs_f64()));
                    }
                }
            }
        }
        if got.is_empty() {
            // No head at all: the server took the body and said nothing, which
            // the desktop treats as a completed chunk.
            return Ok(mbps(chunk.len() as u64, t0.elapsed().as_secs_f64()));
        }
    }
    Err("up: too many redirects".into())
}

/// N chunks of `chunk_mb` megabytes, sequentially, inside `window` seconds.
pub async fn upload(url: &str, window: f64, chunk_mb: usize, seed: u64) -> SpeedOut {
    let start = Instant::now();
    let chunk = filler(chunk_mb * 1024 * 1024, seed);
    let mut rates: Vec<f64> = Vec::new();
    let mut note = String::from("up: no chunk completed");
    while start.elapsed().as_secs_f64() < window {
        match upload_chunk(url, &chunk).await {
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
    let body: Vec<f64> = if rates.len() > 1 { rates[1..].to_vec() } else { rates.clone() };
    let mut sorted = body.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let v = sorted[sorted.len() / 2];
    SpeedOut {
        mbps: Some(v),
        note,
        samples: body,
        bytes: (chunk_mb as u64) * 1024 * 1024,
        secs: start.elapsed().as_secs_f64(),
    }
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
    if let Ok(body) = fetch("https://ipwho.is/", 8).await {
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
    if let Ok(body) = fetch("https://ipapi.co/json/", 8).await {
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
    if let Ok(body) = fetch("https://cloudflare.com/cdn-cgi/trace", 8).await {
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

/// The public test-server lists, fetched backend-side (neither sends CORS
/// headers, and speedtest.net's list is ranked by distance from this address,
/// which is how the desktop picks its servers too). Returns the raw JSON of
/// both sources so the UI applies the desktop's own ranking rules.
pub async fn servers() -> String {
    let ookla = fetch("https://www.speedtest.net/api/js/servers?engine=js&limit=60", 12).await;
    let libre = fetch("https://librespeed.org/backend-servers/servers.php", 12).await;
    let mut out = serde_json::Map::new();
    if let Ok(body) = ookla {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(body.trim()) {
            out.insert("ookla".into(), v);
        }
    }
    if let Ok(body) = libre {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(body.trim()) {
            out.insert("librespeed".into(), v);
        }
    }
    serde_json::Value::Object(out).to_string()
}
