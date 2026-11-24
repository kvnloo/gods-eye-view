#!/bin/bash
# Boot one app checkout with vite dev and run the 6-beat capture against it.
#   run_capture.sh <app-dir> <port> <out-dir> <label> [--video]
# Needs <app-dir>/node_modules (npm ci) and <app-dir>/.env with CESIUM_ION_TOKEN.
# The harness's downstream/ folder is linked into the app root so vite serves
# /downstream/city-loop/filter/cozyValley.js to the page.
set -uo pipefail
APP=$(cd "$1" && pwd); PORT=$2; OUT=$3; LABEL=$4; shift 4
HERE=$(cd "$(dirname "$0")/../../.." && pwd)   # the harness root holding downstream/
[ -e "$APP/downstream" ] || ln -s "$HERE/downstream" "$APP/downstream"
mkdir -p "$OUT"
LOG="$OUT/vite-$LABEL.log"
( cd "$APP" && exec npx vite --host 127.0.0.1 --port "$PORT" --strictPort ) > "$LOG" 2>&1 &
VPID=$!
for i in $(seq 1 120); do curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break; sleep 1; done
curl -sf -o /dev/null "http://127.0.0.1:$PORT/downstream/city-loop/filter/cozyValley.js" && echo "filter-served" || echo "filter-NOT-served"
node "$HERE/downstream/city-loop/capture/capture.mjs" --app "$APP" --url "http://127.0.0.1:$PORT" --out "$OUT" --label "$LABEL" "$@"
rc=$?
kill $VPID 2>/dev/null; wait $VPID 2>/dev/null
# Scrub anything token-like from the vite log before it is kept.
sed -i -E 's/(token|key|access_token)=[^& "]+/\1=REDACTED/Ig' "$LOG"
exit $rc
