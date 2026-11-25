#!/bin/bash
# refresh_fixture.sh <candidate> <radius-m> <out.json>
# Re-make a city-diorama OSM fixture from Overpass, never from the OSM editing
# API (api.openstreetmap.org is for editing, not read-only use:
# https://operations.osmfoundation.org/policies/api/).
#   candidate: a key in candidates.json (northbeach, presidio, sausalito, ...)
#   e.g. refresh_fixture.sh northbeach 760 public/city-diorama/north-beach-r700.osm.json
# Data (c) OpenStreetMap contributors, ODbL 1.0. After a refresh, update the
# source/date row in public/city-diorama/README.md.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
NAME=$1; RADIUS=$2; OUT=$3
mkdir -p "$HERE/osm"
python3 "$HERE/scout.py" fetch "$NAME"            # Overpass XML -> osm/<name>.osm (gitignored scratch)
python3 "$HERE/build_fixture_loc.py" "$NAME" "$OUT" "$RADIUS"
python3 - "$OUT" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
assert d['licence'] == 'ODbL-1.0' and 'Overpass' in d['source'], d.get('source')
assert 'heights' not in d, 'no terrain inside an OSM fixture'
print(sys.argv[1], d['schema'], d['source'][:80], len(d.get('buildings', [])), 'buildings')
EOF
