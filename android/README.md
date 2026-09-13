# QuotaCards Android — project (in progress)

Goal: same app as desktop (server setup, cards, TUN connect) as an APK.

## Stack decision (per owner): Tauri + Kotlin

* UI: **Tauri v2** (`android/tauri-app`) - web UI (HTML/CSS/JS, no bundler),
  Rust backend reusing the desktop core. Phone UI looks native; iteration is
  fast. The egui shell (`qc-mobile/`) is retired - kept until the Tauri build
  passes, then deleted.
* Tunnel (Phase 2): **Kotlin** `VpnService` + Go `libbox.aar` (same recipe as
  sing-box-for-android). Rust/Tauri cannot open a phone tunnel alone - Android
  reserves that for a system VPN service. No Java hand-written code; Kotlin only.

## Why this split

* Core (`config` + `server` + `ssh`) is pure Rust and already compiles for
  `aarch64-linux-android` (proven via the retired shell). `vpn/` stays
  Windows-only (`#[cfg]`).
* Tauri carries the same core over JNI-free invoke commands; the Kotlin
  service (Phase 2) receives card server/uuid/sni via intents.

## Layout

* `qc-mobile/` — Rust cdylib: `android_main`, reuses `quotacards` core.
  `xbuild` reads `[package.metadata.android]` here (package id, SDK levels).
* `toolchain/` — notes + scripts (SDK/NDK install is running, see status).

## Status (honest)

* [x] Rust `aarch64-linux-android` target installed
* [x] Core gated (`vpn` windows-only) — desktop build unaffected
* [x] Android SDK on this box (`C:/Android/Sdk`: platform-35, build-tools, adb)
* [x] NDK r28 (`C:/Android/Sdk/ndk/28.2.13676358`) + dlltool shim
* [x] First `cargo check --target aarch64-linux-android` (needs NDK clang for ring)
* [x] `xbuild apk` + signed: `android/QuotaCards-mobile.apk` (`com.quotacards.app`, 0.1.0)
* [ ] Install on a real phone + first-run test (needs your Android 16 in hand)
* [ ] Phase 2: VpnService + libbox (needs Go + gomobile)

## Toolchain needed (not yet on this box)

* Android cmdline-tools + platform-35 + build-tools + NDK (this box: Java 23 OK)
* `cargo install xbuild` (replaces cargo-apk)
* Phase 2 only: Go + gomobile + sing-box source for libbox.aar
