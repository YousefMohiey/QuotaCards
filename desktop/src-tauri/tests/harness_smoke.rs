//! Bare integration-test target.
//!
//! Cargo refuses the build script's `cargo:rustc-link-arg-tests` (the
//! Common-Controls 6 manifest that test binaries need to load on this
//! toolchain) unless the package has at least one `tests/` target
//! (rust-lang/cargo#10937). This file exists for that alone.
//!
//! It deliberately links nothing from the app: referencing
//! `quotacards_desktop::run` pulls in the WebView2 loader, whose
//! WebView2Loader.dll is not placed beside test binaries, and the exe then
//! dies in the loader before main (0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND).

#[test]
fn test_target_exists() {}
