#!/bin/bash
# Runs ON groot (fed via `ssh groot 'bash -s' < fetch_ion_env.sh`).
# Prints exactly one dotenv line `CESIUM_ION_TOKEN=<value>` to stdout and
# nothing else, so the caller can pipe it straight into a gitignored .env on
# the capture machine. Never echo this output to a log or terminal.
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH
SECRET_ID="${SECRET_ID:?set SECRET_ID to the Bitwarden id of CESIUM_ION_TOKEN}"
tok=$(~/.hermes/bin/hermes-keyring-bootstrap.sh 2>/dev/null | tr ' ' '\n' | sed -n 's/^BWS_ACCESS_TOKEN=//p' | tr -d "'\"" | head -1)
[ -z "$tok" ] && { echo "no-bootstrap-token" >&2; exit 1; }
BWS_ACCESS_TOKEN="$tok" bws secret get "$SECRET_ID" 2>/dev/null | python3 -c '
import json, sys
s = json.load(sys.stdin)
v = (s.get("value") or "").strip()
if not v:
    sys.stderr.write("empty-secret\n"); sys.exit(2)
sys.stdout.write("CESIUM_ION_TOKEN=" + v + "\n")
'
