# QuotaVPN for Android

The phone app: a Tauri v2 web UI over the shared Rust core, with a Kotlin `VpnService` running the sing-box engine (libbox) for the actual tunnel.

## Layout

- `tauri-app/` - the app: phone UI in `ui/`, the Rust bridge and the shared core behind it
- `tauri-plugin-qctunnel/` - Kotlin `VpnService`, libbox engine, Quick Settings tile, per-app picker (`android/libs/libbox.aar` is the prebuilt sing-box library)
- `tauri-cli-npm/` - pinned Tauri CLI used by the build scripts

## Build

From the repo root:

```bash
bash tools/build-apk.sh
```

That sets the toolchain env, syncs the shared assets, builds, zipaligns and signs with the release keystore, then verifies the signature. Output: `android/QuotaVPN-mobile-signed.apk`.

Needs Rust stable with the Android targets, Android SDK 35 + NDK 28, and JDK 23. Go and gomobile are only needed when regenerating `libbox.aar`.

## Updates

The app checks GitHub Releases for the signed APK and opens the installer (Settings, Updates, one confirmation tap).
