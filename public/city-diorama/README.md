# city-diorama fixtures (fork-only experiment)

The `*.osm.json` files here are derived from **OpenStreetMap** data,
© OpenStreetMap contributors, available under the
[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
(see https://www.openstreetmap.org/copyright). The repository's MIT licence does
**not** cover these files; they are a Derivative Database under the ODbL only, and
anyone redistributing them must keep this notice and the ODbL terms.

| File | Area | Source | Method |
|---|---|---|---|
| `north-beach.osm.json`, `north-beach-r700.osm.json` | North Beach, San Francisco (520 m / 760 m around Washington Square) | `api.openstreetmap.org/api/0.6/map`, 2026-11-22 | `build_fixture.py` (exp/city-look-diorama) |
| `presidio.osm.json` | Presidio Main Post / Crissy Marsh, San Francisco (760 m) | Overpass API, 2026-11-22 | `build_fixture_loc.py` (exp/city-loc-green) |
| `sausalito.osm.json` | Sausalito waterfront, Dunphy Park (760 m) | Overpass API, 2026-11-22 | `build_fixture_loc.py` (exp/city-loc-green) |

Transform: building footprints, highways, green and water areas and `natural=tree`
nodes, reprojected to local east/north metres around the location's play plot centre.
Fixture schema `@2` adds `water`: a 4 m run-length raster of water bodies, made from
OSM water/wetland areas, waterways and the sea rebuilt from `natural=coastline`.

Terrain: the `?cityLoc=` locations carry **no** terrain heights. The page samples
Cesium World Terrain from ion at run time and keeps it in memory only, because the
Cesium ion terms do not allow storing sampled heights. The two older
`north-beach*.ground.json` files predate that finding (exp/city-look-diorama); whether
to remove them is the owner's decision. `?cityLoc=northbeach-live` ignores them.
