//! Desktop build: Tauri codegen plus the Windows UAC manifest (TUN mode
//! needs admin) and app icon, embedded with windres. Degrades to a
//! warning, never a build failure, if no resource compiler is found.
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    // repo root two levels up: desktop/src-tauri -> desktop -> root
    let root = manifest_dir.join("..").join("..");

    // Build identity for the updater: a hotfix re-released under the same
    // version number differs only by build, so the app compares this stamp
    // against the feed's "build" field. Falls back to "dev" (git missing,
    // not a checkout), and a dev build is never offered a same-version
    // update because it has no identity to compare.
    let stamp = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(&root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=QC_BUILD={stamp}");
    // Re-read the stamp whenever either side of the ref moves: the HEAD file
    // changes on checkouts, while a commit only advances the branch ref under
    // refs/heads (cargo watches a directory recursively). Watching HEAD alone
    // kept the PREVIOUS commit's stamp in a rebuild after a commit, and a
    // stale stamp makes the updater re-offer the same release forever.
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs/heads");

    tauri_build::build();

    let target = env::var("TARGET").unwrap_or_default();
    if !target.contains("windows") {
        return;
    }
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
                // Test binaries need the Common-Controls 6 manifest too, or the
                // GNU-toolchain loader kills them before main (0xc0000139
                // STATUS_ENTRYPOINT_NOT_FOUND). They get an asInvoker copy: the
                // app manifest demands admin and a test runner must not.
                let test_manifest = out.join("test.manifest");
                let _ = fs::write(
                    &test_manifest,
                    concat!(
                        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n",
                        "<assembly xmlns=\"urn:schemas-microsoft-com:asm.v1\" manifestVersion=\"1.0\">\n",
                        "  <dependency><dependentAssembly><assemblyIdentity type=\"win32\" ",
                        "name=\"Microsoft.Windows.Common-Controls\" version=\"6.0.0.0\" ",
                        "processorArchitecture=\"*\" publicKeyToken=\"6595b64144ccf1df\" ",
                        "language=\"*\"/></dependentAssembly></dependency>\n",
                        "</assembly>\n"
                    ),
                );
                let test_rc = out.join("test.rc");
                let test_res = out.join("test.res");
                let tm = test_manifest.to_string_lossy().replace('\\', "/");
                if fs::write(&test_rc, format!("1 RT_MANIFEST \"{tm}\"\n")).is_ok()
                    && std::process::Command::new(w)
                        .args([
                            test_rc.to_string_lossy().as_ref(),
                            "-O",
                            "coff",
                            "-o",
                            test_res.to_string_lossy().as_ref(),
                        ])
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false)
                    && test_res.exists()
                {
                    println!("cargo:rustc-link-arg-tests={}", test_res.to_string_lossy());
                }
            } else {
                println!("cargo:warning=windres failed; building without admin manifest");
            }
        }
        None => println!("cargo:warning=windres not found; building without admin manifest"),
    }
    println!("cargo:rerun-if-changed=../../res/quotacards.manifest");
    println!("cargo:rerun-if-changed=../../res/app-icon.ico");
}
