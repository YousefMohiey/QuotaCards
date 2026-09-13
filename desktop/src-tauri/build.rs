//! Desktop build: Tauri codegen plus the Windows UAC manifest (TUN mode
//! needs admin) and app icon, embedded with windres. Degrades to a
//! warning, never a build failure, if no resource compiler is found.
use std::{env, fs, path::PathBuf};

fn main() {
    tauri_build::build();

    let target = env::var("TARGET").unwrap_or_default();
    if !target.contains("windows") {
        return;
    }
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    // repo root two levels up: desktop/src-tauri -> desktop -> root
    let root = manifest_dir.join("..").join("..");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let rc = out.join("quotacards.rc");
    let res = out.join("quotacards.res");
    let mf = root.join("res").join("quotacards.manifest");
    // forward slashes: backslashes would parse as escapes inside the .rc
    let mf_res = mf.to_string_lossy().replace('\\', "/");
    let icon = root.join("res").join("app-icon.ico");
    let icon_res = icon.to_string_lossy().replace('\\', "/");
    fs::write(
        &rc,
        format!("1 RT_MANIFEST \"{mf_res}\"\nIDI_ICON1 ICON \"{icon_res}\"\n"),
    )
    .unwrap();
    let windres = ["windres.exe", "x86_64-w64-mingw32-windres.exe"]
        .into_iter()
        .find(|w| std::process::Command::new(w).arg("--version").output().is_ok())
        .or_else(|| {
            let known = PathBuf::from(r"C:\Tools\mingw_extract\mingw64\bin\windres.exe");
            known.exists().then_some("C:\\Tools\\mingw_extract\\mingw64\\bin\\windres.exe")
        });
    match windres {
        Some(w) => {
            let ok = std::process::Command::new(w)
                .args([
                    rc.to_string_lossy().as_ref(),
                    "-O",
                    "coff",
                    "-o",
                    res.to_string_lossy().as_ref(),
                ])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok && res.exists() {
                println!("cargo:rustc-link-arg-bins={}", res.to_string_lossy());
            } else {
                println!("cargo:warning=windres failed; building without admin manifest");
            }
        }
        None => println!("cargo:warning=windres not found; building without admin manifest"),
    }
    println!("cargo:rerun-if-changed=../../res/quotacards.manifest");
    println!("cargo:rerun-if-changed=../../res/app-icon.ico");
}
