#!/usr/bin/env bash
# Package, sign and install the GEV Samsung TV app (the Cast button's Samsung
# route), then launch it. Run on the TV's developer-mode Host PC (the TV only
# accepts sdb from that address), with Tizen Studio and an author profile.
# Usage: tools/gev-tv/install.sh <tv-ip> <gev-tv-origin>
#   e.g. tools/gev-tv/install.sh 192.168.1.28 http://192.168.1.8:8803/
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
TV=${1:?tv ip}; SITE=${2:?gev origin the TV can reach, e.g. http://192.168.1.8:8803/}
PROFILE=${TIZEN_PROFILE:-JellyfinTV}
export PATH="$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools:$PATH"
out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
cp "$here"/config.xml "$here"/index.html "$here"/main.js "$here"/style.css "$here"/icon.png "$out/"
printf '// Written by install.sh: where this TV loads GEV from.\nvar SITE = "%s";\n' "${SITE%/}/" > "$out/site.js"
src=$(curl -fsS --max-time 4 "http://$TV:8001/api/v2/" | grep -oP '"developerIP":"\K[0-9.]+')
port=26111
ip -4 addr | grep -q "inet $src/" || { echo "TV developer mode wants Host PC IP $src, which is not on this host" >&2; exit 1; }
# A relay bound to the developer IP gets sdb through the TV's Host PC check.
socat TCP-LISTEN:$port,bind=127.0.0.1,reuseaddr,fork TCP:$TV:26101,bind="$src" & relay=$!
trap 'kill $relay 2>/dev/null; rm -rf "$out"' EXIT
sdb disconnect 127.0.0.1:$port >/dev/null 2>&1 || true; sleep 0.5; timeout 20 sdb connect 127.0.0.1:$port
(cd "$out" && tizen build-web -- . >/dev/null && tizen package -t wgt -s "$PROFILE" -o "$out" -- "$out/.buildResult" </dev/null | tail -1)
mv "$out"/*.wgt "$out/GodsEyeView.wgt"
timeout 120 tizen install -s 127.0.0.1:$port -n GodsEyeView.wgt -- "$out" | tail -3
curl -fsS -X POST "http://$TV:8001/api/v2/applications/GEVCastTV1.GodsEyeView" && echo " launched"
