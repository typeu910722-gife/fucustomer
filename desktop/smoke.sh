#!/usr/bin/env bash
# Headless smoke test of the desktop shell (Linux + xvfb). Checks the page loads, the bridge exists,
# and Steam fails gracefully (no Steam client here): once without an App ID, once with Valve's test app 480.
set -euo pipefail
cd "$(dirname "$0")"
[ -d web ] || node build-web.cjs
for id in "" 480; do
  out=$(STEAM_APP_ID="$id" FU_DESKTOP_SMOKE=1 timeout 60 xvfb-run -a ./node_modules/.bin/electron . --no-sandbox --windowed --disable-gpu 2>&1 | grep '^SMOKE' || true)
  echo "APP_ID=${id:-none}: $out"
  echo "$out" | grep -q '"bridge":true' && echo "$out" | grep -q '"menu":true' || { echo FAIL; exit 1; }
done
echo OK
