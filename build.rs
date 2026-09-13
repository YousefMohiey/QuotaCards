//! Build script: bakes the device key in when present.
//!
//! - `embed/quotacards-embed.pem` exists  → auto-connect mode (fresh devices
//!   work with zero setup against the owner's server, via the restricted
//!   `qc-agent` forced command — the key cannot open a shell).
//! - missing → manual mode (user connects their own server in the Server tab).
//! The private key file is gitignored and never committed.
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let pem_path = manifest.join("embed").join("quotacards-embed.pem");
    let body = match fs::read_to_string(&pem_path) {
        Ok(pem) if !pem.trim().is_empty() => {
            let esc = pem.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
            format!("pub const EMBED_KEY: Option<&str> = Some(\"{esc}\");\n")
        }
        _ => "pub const EMBED_KEY: Option<&str> = None;\n".to_string(),
    };
    fs::write(out.join("embed.rs"), body).unwrap();
    println!("cargo:rerun-if-changed=embed/quotacards-embed.pem");

    // short git hash baked in so "which build are you on" is answerable
    let build_id = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(&manifest)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=QUOTACARDS_BUILD={build_id}");
    println!("cargo:rerun-if-changed=.git/HEAD");
}
