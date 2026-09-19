//! The official Ookla Speedtest CLI, bundled into the app.
//!
//! This is the same binary (and therefore the same server selection and the
//! same measurement) that speedtest.net's own command line client runs, so a
//! reading here is directly comparable to the website's, including servers
//! hosted inside the user's provider. The binary is fetched from Ookla's CDN
//! on first use and cached under the app data dir; nothing is redistributed.
//!
//! One human-readable run feeds everything: the progress lines give the live
//! Mbps for the bars, the result block gives the final numbers, the server
//! and ISP lines, and the speedtest.net result URL.

use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use serde::Serialize;

const CLI_ZIP: &str =
    "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-win64.zip";
const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0";

#[derive(Clone, Default, Serialize, Debug)]
pub struct CliResult {
    pub ping_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub down_mbps: Option<f64>,
    pub up_mbps: Option<f64>,
    pub packet_loss: Option<f64>,
    pub server_name: Option<String>,
    pub server_location: Option<String>,
    pub server_country: Option<String>,
    pub server_host: Option<String>,
    pub isp: Option<String>,
    pub result_url: Option<String>,
}

/// Where the CLI lives once fetched.
pub fn bin_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("quotacards").join("bin")
}

/// The cached CLI, downloading and unpacking it once if needed. Returns None
/// when the fetch or the unpack fails, and the caller falls back to the
/// built-in measurement.
pub async fn ensure_binary() -> Option<PathBuf> {
    let dir = bin_dir();
    let exe = dir.join("speedtest.exe");
    if exe.is_file() {
        return Some(exe);
    }
    std::fs::create_dir_all(&dir).ok()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .user_agent(UA)
        .build()
        .ok()?;
    let bytes = client.get(CLI_ZIP).send().await.ok()?.bytes().await.ok()?;
    if bytes.len() < 500_000 {
        return None;
    }
    let zip = dir.join("ookla-cli.zip");
    std::fs::write(&zip, &bytes).ok()?;

    // Windows' own bsdtar unpacks zips; the tar on PATH in a dev shell is GNU
    // tar, which cannot, so call the system one by full path.
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let tar = PathBuf::from(sysroot).join("System32").join("tar.exe");
    let extracted = std::process::Command::new(&tar)
        .arg("-xf")
        .arg(&zip)
        .arg("-C")
        .arg(&dir)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let _ = std::fs::remove_file(&zip);
    if !extracted || !exe.is_file() {
        return None;
    }
    Some(exe)
}

/// Everything the parser learned from one run.
#[derive(Default)]
pub struct Parsed {
    result: CliResult,
    last_down: Option<f64>,
    last_up: Option<f64>,
    /// The "Idle Latency:" report, preferred over any other latency line: the
    /// human output also prints a loaded-latency figure later, and the ping a
    /// speed test is expected to show is the idle one.
    ping_idle: Option<f64>,
    jitter_idle: Option<f64>,
}

fn number_after(line: &str, key: &str) -> Option<f64> {
    let at = line.find(key)? + key.len();
    let tail = line[at..].trim_start();
    let tok: String = tail
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    tok.parse::<f64>().ok()
}

/// One thing the parser wants the UI told about: a phase change or a value
/// that just finalized mid-run.
pub enum Ev {
    /// Live value for a phase; NaN means "phase only, no tick".
    Tick(String, f64),
    /// A value as it lands (ping, jitter, down, up).
    Result(serde_json::Value),
}

/// Turns parser events into callbacks. One thing it guarantees: the phase is
/// announced ONCE per change. The client reprints its progress line ten times
/// a second, and announcing the phase on every one of those lines made the UI
/// reset its bars on every tick, so the graph never grew and the run looked
/// dead next to the moving number.
pub struct Emitter {
    last_phase: Option<String>,
}

impl Emitter {
    pub fn new() -> Self {
        Self { last_phase: None }
    }

    pub fn handle(
        &mut self,
        ev: Ev,
        on_phase: &Arc<dyn Fn(&str) + Send + Sync>,
        on_tick: &Arc<dyn Fn(f64) + Send + Sync>,
        on_result: &Arc<dyn Fn(serde_json::Value) + Send + Sync>,
    ) {
        match ev {
            Ev::Tick(phase, v) => {
                if self.last_phase.as_deref() != Some(phase.as_str()) {
                    self.last_phase = Some(phase.clone());
                    on_phase(&phase);
                }
                if !v.is_nan() {
                    on_tick(v);
                }
            }
            Ev::Result(j) => on_result(j),
        }
    }
}

impl Parsed {
    /// Progress lines look like:
    ///   Download:    45.67 Mbps [=====/          ] 26%   - latency: 232.68 ms
    /// while the final block prints the same keys without the bar:
    ///   Download:    59.80 Mbps (data used: 52.3 MB)
    /// Only the final lines set the reported numbers; the bar lines feed the
    /// live ticks. (The upload phase's first progress line carries a leftover
    /// download figure, so trusting the ticks over the finals would report the
    /// wrong download.)
    pub fn feed(&mut self, line: &str, out: &mut Vec<Ev>) {
        let t = line.trim();
        // The client announces its server selection before any measurement;
        // the UI shows a "finding the server" state for that stretch instead
        // of a dead screen.
        if t.starts_with("Selecting server") || t.starts_with("Selecting best server") {
            // NaN marks "phase only, no tick": the value stays where it was.
            out.push(Ev::Tick("select".into(), f64::NAN));
            return;
        }
        let is_down = t.starts_with("Download:");
        let is_up = t.starts_with("Upload:");
        if is_down || is_up {
            let Some(v) = number_after(t, ":") else { return };
            if t.contains('[') {
                let phase = if is_down { "download" } else { "upload" };
                out.push(Ev::Tick(phase.into(), v));
                if is_down {
                    self.last_down = Some(v);
                } else {
                    self.last_up = Some(v);
                }
            } else if is_down {
                self.result.down_mbps = Some(v);
                out.push(Ev::Result(serde_json::json!({ "down": v })));
            } else {
                self.result.up_mbps = Some(v);
                out.push(Ev::Result(serde_json::json!({ "up": v })));
            }
            return;
        }

        // Any block carrying "(jitter:" is a latency report. The one that
        // matters is "Idle Latency: 6.13 ms (jitter: ...)"; a loaded-latency
        // line can follow it, and that one must not become the headline ping.
        if let Some(i) = t.find("(jitter:") {
            let idle = t.starts_with("Idle Latency") || t.starts_with("Latency");
            if let Some(v) = number_after(&t[i..], "jitter:") {
                self.result.jitter_ms = Some(v);
                if idle {
                    self.jitter_idle = Some(v);
                }
            }
            let head = &t[..i];
            let toks: Vec<&str> = head.split_whitespace().collect();
            for (k, tok) in toks.iter().enumerate() {
                if *tok == "ms" || tok.starts_with("ms") {
                    if k > 0 {
                        if let Ok(v) = toks[k - 1].trim_end_matches(',').parse::<f64>() {
                            self.result.ping_ms = Some(v);
                            if idle {
                                self.ping_idle = Some(v);
                            }
                        }
                    }
                }
            }
            // The idle figures are the headline ones: hand them over the
            // moment they are measured, not at the end of the whole run.
            if idle {
                let mut part = serde_json::Map::new();
                if let Some(p) = self.ping_idle {
                    part.insert("ping".to_string(), serde_json::json!(p));
                }
                if let Some(j) = self.jitter_idle {
                    part.insert("jitter".to_string(), serde_json::json!(j));
                }
                if !part.is_empty() {
                    out.push(Ev::Result(serde_json::Value::Object(part)));
                }
            }
            return;
        }

        if t.starts_with("Packet Loss:") {
            self.result.packet_loss = number_after(t, "Packet Loss:");
            return;
        }
        if t.starts_with("Server:") || t.starts_with("Hosted by") {
            let rest = t
                .trim_start_matches("Server:")
                .trim_start_matches("Hosted by")
                .trim();
            // "we - Giza (id: 51343)" or "we (Giza, Egypt) [17.24 km]"
            if let Some(open) = rest.find('(') {
                let head = rest[..open].trim();
                let close = rest[open + 1..].find(')').map(|c| open + 1 + c).unwrap_or(rest.len());
                let inside = rest[open + 1..close].trim();
                if let Some((name, place)) = head.split_once(" - ") {
                    self.result.server_name = Some(name.trim().to_string());
                    self.result.server_location = Some(place.trim().to_string());
                } else {
                    self.result.server_name = Some(head.to_string());
                    if !inside.starts_with("id") {
                        let mut parts = inside.split(',').map(|s| s.trim());
                        self.result.server_location = parts.next().map(|s| s.to_string());
                        self.result.server_country = parts.next().map(|s| s.to_string());
                    }
                }
            } else {
                self.result.server_name = Some(rest.to_string());
            }
            return;
        }
        if t.starts_with("ISP:") {
            self.result.isp = Some(t.trim_start_matches("ISP:").trim().to_string());
            return;
        }
        if let Some(i) = t.find("Result URL:") {
            self.result.result_url = Some(t[i + "Result URL:".len()..].trim().to_string());
        }
    }

    /// Whatever a phase never finalized falls back to its last live tick, and
    /// the idle latency wins over any loaded figure for the headline numbers.
    fn finish(mut self) -> CliResult {
        if self.result.down_mbps.is_none() {
            self.result.down_mbps = self.last_down;
        }
        if self.result.up_mbps.is_none() {
            self.result.up_mbps = self.last_up;
        }
        if let Some(v) = self.ping_idle {
            self.result.ping_ms = Some(v);
        }
        if let Some(v) = self.jitter_idle {
            self.result.jitter_ms = Some(v);
        }
        self.result
    }
}

/// Runs the CLI once. Live progress is reported through the callbacks: the
/// phase ("download"/"upload") and the current Mbps, so the UI animates
/// exactly as it does for the built-in measurement.
pub fn run(
    exe: &Path,
    on_phase: Arc<dyn Fn(&str) + Send + Sync>,
    on_tick: Arc<dyn Fn(f64) + Send + Sync>,
    on_result: Arc<dyn Fn(serde_json::Value) + Send + Sync>,
) -> Option<CliResult> {
    let mut cmd = Command::new(exe);
    cmd.args([
        "--accept-license",
        "--accept-gdpr",
        "--progress=yes",
        "--progress-update-interval=100",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // The CLI is a console program: without this flag Windows opens a
        // terminal window for it every time a test runs.
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().ok()?;

    let parsed = Arc::new(Mutex::new(Parsed::default()));
    let mut readers = Vec::new();
    for stream in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let parsed = Arc::clone(&parsed);
        let on_phase = Arc::clone(&on_phase);
        let on_tick = Arc::clone(&on_tick);
        let on_result = Arc::clone(&on_result);
        readers.push(std::thread::spawn(move || {
            // Read raw bytes, not lines: the CLI rewrites its progress line in
            // place with a carriage return and only emits a newline when the
            // phase ends. Waiting for a newline holds every tick back until the
            // end, which is exactly how "the numbers arrive after they are
            // already calculated" happened.
            let mut em = Emitter::new();
            let mut reader = BufReader::new(stream);
            let mut buf = [0u8; 4096];
            let mut carry = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        carry.push_str(&text);
                        // Keep the last partial segment for the next read.
                        let mut parts: Vec<String> =
                            carry.split(['\r', '\n']).map(|s| s.to_string()).collect();
                        let tail = parts.pop().unwrap_or_default();
                        carry = tail;
                        for part in &parts {
                            if part.trim().is_empty() {
                                continue;
                            }
                            let mut evs: Vec<Ev> = Vec::new();
                            parsed.lock().unwrap().feed(part, &mut evs);
                            for ev in evs {
                                em.handle(ev, &on_phase, &on_tick, &on_result);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            // Whatever the last partial segment held.
            let last = carry.trim().to_string();
            if !last.is_empty() {
                let mut evs: Vec<Ev> = Vec::new();
                parsed.lock().unwrap().feed(&last, &mut evs);
                for ev in evs {
                    em.handle(ev, &on_phase, &on_tick, &on_result);
                }
            }
        }));
    }
    let status = {
        // Watchdog: a wedged CLI (dead network, a hung checkin) must not leave
        // the app waiting forever. Kill it after 90 seconds and report what the
        // parser saw, so the caller can fall back to the built-in measurement.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        loop {
            match child.try_wait() {
                Ok(Some(st)) => break Some(st),
                Ok(None) => {
                    if std::time::Instant::now() > deadline {
                        let _ = child.kill();
                        break child.wait().ok();
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(_) => break None,
            }
        }
    };
    for t in readers {
        let _ = t.join();
    }
    let out = Arc::try_unwrap(parsed)
        .map(|m| m.into_inner().unwrap())
        .unwrap_or_else(|arc| Parsed {
            result: arc.lock().unwrap().result.clone(),
            ..Default::default()
        });
    let result = out.finish();
    let ok = status.map(|s| s.success()).unwrap_or(false);
    if !ok && result.down_mbps.is_none() {
        return None;
    }
    Some(result)
}

