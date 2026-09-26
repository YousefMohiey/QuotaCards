#!/usr/bin/env bash
# Refresh both live demos on the website from the apps that ship:
#   desktop/ui-next  -> docs/app   (the Windows demo and the APK's sibling)
#   android/tauri-app/ui -> docs/phone (the Android demo)
# Run this after ANY UI change and again after a release, so the site is never
# showing an older build than the release it advertises.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== desktop ui-next -> docs/app =="
cd "$ROOT/desktop/ui-next"
rm -rf dist
# The project's own script, not a bare vite build: the tsc pass it runs first
# is load bearing (a raw vite build ships a bundle whose React dispatcher is
# null and the page mounts to nothing).
npm run build -- --base=./ >/dev/null
cd "$ROOT"
rm -rf docs/app
cp -r desktop/ui-next/dist docs/app
# Anything the bundle still points at with a leading slash would resolve to the
# domain root, not to /QuotaVPN/, so make those relative before shipping.
python - <<'PY'
# newline="" on both ends: this file is a build artifact and every bare newline
# in it is meaningful (one lives inside a template literal). Letting Python
# translate them corrupts the bundle.
import io, pathlib, re
n = 0
for f in (pathlib.Path("docs/app/assets")).glob("*.js"):
    t = io.open(f, encoding="utf-8", newline="").read()
    t2 = re.sub(r'url\(/(?!/)', 'url(./', t)
    t2 = re.sub(r'"/assets/', '"./assets/', t2)
    if t2 != t:
        io.open(f, "w", encoding="utf-8", newline="").write(t2)
        n += 1
print("absolute refs fixed in", n, "file(s)")
PY

echo "== phone ui -> docs/phone =="
bash "$ROOT/tools/sync-phone-demo.sh"
echo SITE_SYNCED
