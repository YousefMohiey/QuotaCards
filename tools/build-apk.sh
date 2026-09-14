#!/usr/bin/env bash
# Build, align and sign the QuotaCards Android APK.
# Usage: bash tools/build-apk.sh
# Output: android/QuotaCards-mobile-signed.apk (+ SIGN_VERIFY_OK)
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/c/Tools/mingw_extract/mingw64/bin:/c/Tools/dllshim:/c/Users/Administrator/AppData/Local/hermes/node:$HOME/.cargo/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-C:/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
NDK="${ANDROID_NDK_HOME:-C:/Android/Sdk/ndk/28.2.13676358}"
export ANDROID_NDK_HOME="$NDK" ANDROID_NDK_ROOT="$NDK"
export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Java/jdk-23}"
BT="$ANDROID_HOME/build-tools/35.0.0"
TARGET=aarch64

export CC_aarch64_linux_android="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android35-clang.cmd"
export AR_aarch64_linux_android="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-ar.exe"

# The APK packs gen/android/app/src/main/assets - keep it in step with ui/.
bash "$ROOT/tools/sync-mobile-assets.sh"

cd "$ROOT/android/tauri-app/src-tauri"
node ../../tauri-cli-npm/node_modules/@tauri-apps/cli/tauri.js android build -t "$TARGET" --apk

UNSIGNED="$ROOT/android/tauri-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk"
[ -f "$UNSIGNED" ] || { echo "NO_UNSIGNED_APK"; exit 1; }

. /c/Tools/qc-keystore-pass.txt
KS="C:/Tools/qc-release.keystore"
ALIAS="$("$JAVA_HOME/bin/keytool.exe" -list -keystore "$KS" -storepass "$KEYSTORE_PASS" | grep -i privatekeyentry | head -1 | cut -d, -f1)"

"$BT/zipalign.exe" -f -p 4 "$UNSIGNED" "$ROOT/android/app-aligned.apk"
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass "pass:$KEYSTORE_PASS" --ks-key-alias "$ALIAS" \
  --out "$ROOT/android/QuotaCards-mobile-signed.apk" "$ROOT/android/app-aligned.apk"
rm -f "$ROOT/android/app-aligned.apk"

"$BT/apksigner.bat" verify "$ROOT/android/QuotaCards-mobile-signed.apk" && echo SIGN_VERIFY_OK
"$BT/aapt.exe" dump badging "$ROOT/android/QuotaCards-mobile-signed.apk" | head -1
ls -la "$ROOT/android/QuotaCards-mobile-signed.apk"
echo APK_BUILD_DONE
