#!/usr/bin/env bash
# Refresh the copy of the phone UI that the website serves under /phone.
# The source files are the ones packed into the APK; the only difference is the
# demo bridge, which fakes the native calls in a browser.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/android/tauri-app/ui"
DST="$ROOT/docs/phone"
mkdir -p "$DST"
cp "$SRC/index.html" "$SRC/app.js" "$SRC/style.css" "$SRC/icon.png" "$DST/"
rm -rf "$DST/fonts" && cp -r "$SRC/fonts" "$DST/fonts"
# Native python cannot read an MSYS path; hand it a Windows one.
python "$(cygpath -w "$ROOT/tools/inject-demo-bridge.py")" "$(cygpath -w "$DST/index.html")"
echo PHONE_DEMO_SYNCED
