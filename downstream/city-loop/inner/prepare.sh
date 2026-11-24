#!/usr/bin/env bash
# FORK-ONLY (fix1 inner loop): one-time cache setup, all OUTSIDE git.
#  1. USGS 3DEP terrain (public domain) for the QA locations -> $GEV_DEM_DIR
#  2. North Beach's fixture is schema@1 (no water raster): rebuild an @2 copy of
#     the same centre from the raw Overpass XML with build_fixture_loc.py, and
#     keep only its `water` raster for the harness. Needs numpy + pillow (a venv
#     under $GEV_DEM_DIR) and the raw XML ($GEV_OSM_XML_DIR/northbeach.osm).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DEM=${GEV_DEM_DIR:-$HOME/.cache/gev-dem}
XML=${GEV_OSM_XML_DIR:-$HOME/.hermes/profiles/tek/cache/scratch/loc/osm}
mkdir -p "$DEM"
node "$HERE/fetch-dem.mjs"
if [ ! -f "$DEM/northbeach-water.osm.json" ] && [ -f "$XML/northbeach.osm" ]; then
  [ -x "$DEM/venv/bin/python" ] || { python3 -m venv "$DEM/venv" && "$DEM/venv/bin/pip" -q install numpy pillow; }
  work="$DEM/nbwater"; mkdir -p "$work/osm"
  cp "$HERE/../location/"{build_fixture_loc.py,scout.py,candidates.json} "$work/"
  cp "$XML/northbeach.osm" "$work/osm/"
  (cd "$work" && "$DEM/venv/bin/python" -I build_fixture_loc.py northbeach northbeach-water.osm.json 760)
  cp "$work/northbeach-water.osm.json" "$DEM/"
fi
ls -la "$DEM"
