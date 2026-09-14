#!/usr/bin/env bash
# Sync the mobile frontend into the Android staging folder that gets packed
# into the APK. tauri android build does NOT refresh these files on its own,
# so a stale copy here silently ships old UI code (this bit us: an APK was
# built with a month-old app.js). Always run this before an android build.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="android/tauri-app/ui"
DST="android/tauri-app/src-tauri/gen/android/app/src/main/assets"
if [ ! -d "$DST" ]; then echo "staging dir missing: $DST" >&2; exit 1; fi
for f in app.js index.html style.css; do
  cp "$SRC/$f" "$DST/$f"
done
cp -r "$SRC/fonts" "$DST/"
cp "$SRC/icon.png" "$DST/icon.png"
echo "synced $SRC -> $DST"
