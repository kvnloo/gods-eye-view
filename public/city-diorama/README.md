# city-diorama fixtures (fork-only experiment)

## Licence: ODbL, not MIT

The `*.osm.json` files in this directory contain information from
**OpenStreetMap**, © OpenStreetMap contributors, available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
See https://www.openstreetmap.org/copyright.

**The repository's MIT licence does not cover these files.** They are a
Derivative Database of OpenStreetMap and are licensed under the ODbL 1.0 only.
Anyone who redistributes them, or a database made from them, must keep this
notice and offer the result under the ODbL.

Each file also says so in its header: `"licence": "ODbL-1.0"` and
`"attribution": "© OpenStreetMap contributors"`. The `@2` files also carry
`"licenceUrl"` and `"copyright"` links.

## Files

| File | Area | Source | Fetched | Method |
|---|---|---|---|---|
| `north-beach.osm.json` | North Beach, San Francisco, 520 m around Washington Square | OSM editing API, `api.openstreetmap.org/api/0.6/map` (see "Refreshing") | 2026-11-22 | `downstream/city-loop/location/build_fixture_v1.py` (exp/city-look-diorama, schema `@1`) |
| `north-beach-r700.osm.json` | the same, 760 m | OSM editing API, as above | 2026-11-22 | as above |
| `presidio.osm.json` | Presidio Main Post / Crissy Marsh, San Francisco, 760 m | Overpass API (`overpass-api.de`, `maps.mail.ru` mirror) | 2026-11-22 | `downstream/city-loop/location/build_fixture_loc.py` (schema `@2`) |
| `sausalito.osm.json` | Sausalito waterfront (Dunphy Park), 760 m | Overpass API, as above | 2026-11-22 | as above |

## Transform (ODbL 4.6: how the data was altered)

- Kept: building footprints (with `height`, `building:levels`, `building`,
  `name`), highways (`highway`, `name`), green and water areas (`leisure`,
  `landuse`, `natural`, `waterway`), and `natural=tree` nodes.
- Reprojected from WGS84 to local east/north metres around the location's play
  plot centre (equirectangular, 111,320 m per degree of latitude).
- Clipped to the disc radius given in each header.
- Schema `@2` adds `water`: a 4 m run-length raster of water bodies, made from
  OSM water and wetland areas, waterways, and the sea rebuilt from
  `natural=coastline`, with one id per connected body.
- Code: `downstream/city-loop/location/build_fixture_loc.py` (with
  `scout.py fetch` for the Overpass query). The `@1` North Beach files were made
  by `build_fixture_v1.py`: the same transform minus the water raster.

## Terrain is not stored here

No file in this directory holds terrain heights. Every location, North Beach
included, samples **Cesium World Terrain** from Cesium ion in the page when the
diorama mounts, with the app's ion token, and keeps the heights in memory only
(`sampleGround()` in `src/standalone/cityDiorama.js`). The Cesium ion terms
(ToS §2.2.2) do not allow storing or redistributing sampled heights, so the
earlier `north-beach*.ground.json` files were removed from the tree in
exp/city-loop-v4. They remain in older commits of this fork's history; whether
to rewrite that history is the owner's decision.

Terrain and OSM data are kept apart on purpose (ODbL §4.4(d)): the terrain's
attributions (the Cesium ion logo, USGS and the other sources ion lists) are
shown in Cesium's credit display next to the OpenStreetMap credit.

## Refreshing

The two North Beach files came from the OSM **editing** API, which the OSM API
usage policy (https://operations.osmfoundation.org/policies/api/) reserves for
editing, not read-only use. **Do not refresh any fixture from
`api.openstreetmap.org`.** Use Overpass or a Geofabrik/planet extract, and
record the source and date in the table above:

```
downstream/city-loop/location/refresh_fixture.sh northbeach 760 public/city-diorama/north-beach-r700.osm.json
```

That script queries Overpass (`scout.py fetch`) and runs `build_fixture_loc.py`.
A refreshed North Beach file is schema `@2` (it adds the water raster).
