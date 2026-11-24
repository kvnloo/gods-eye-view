#!/bin/bash
# Round 1 captures on ONE capture box (Boat), after the token is installed in BOTH app dirs:
#   ssh groot 'SECRET_ID=… bash -s' < fetch_ion_env.sh | <stdin-capable channel to box> 'bash install_env_remote.sh <r1-dir> <parent-dir>'
#   run_r1.sh <r1 app dir (exp/city-loop-r1)> <parent app dir (f81b247 = 23206e62 + harness)> <out dir>
# Produces:
#   <out>/r0b-parent : step 0 baseline recapture of the parent tree (round-0 harness look as the --cozy variant)
#   <out>/r1-all     : the candidate with every round-1 switch (?cityR1=all); CLEAR = <beat>.png,
#                      LOOK = <beat>--cozy.png from the app's own ?look=cozy chain (--look-app), + journey MP4
# Both must report manifest.tiles.rendering == google-photoreal-3d-tiles, else the round is INVALID.
set -uo pipefail
R1=$1; PARENT=$2; OUT=$3
HERE=$(cd "$(dirname "$0")/.." && pwd)
for d in "$R1" "$PARENT"; do grep -q '^CESIUM_ION_TOKEN=' "$d/.env" 2>/dev/null || { echo "no token in $d/.env"; exit 2; }; done
mkdir -p "$OUT"
timeout 1700 bash "$HERE/capture/run_capture.sh" "$PARENT" 4192 "$OUT/r0b-parent" r0b-parent > "$OUT/r0b-parent.log" 2>&1
timeout 1700 bash "$HERE/capture/run_capture.sh" "$R1" 4193 "$OUT/r1-all" r1-all --query cityR1=all --look-app --video > "$OUT/r1-all.log" 2>&1
for m in "$OUT"/r0b-parent/manifest.json "$OUT"/r1-all/manifest.json; do
  python3 - "$m" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))
print(sys.argv[1], m["app"]["sha"][:9], m["tiles"].get("rendering"), {k: v["status"] for k, v in m["beats"].items()})
EOF
done
