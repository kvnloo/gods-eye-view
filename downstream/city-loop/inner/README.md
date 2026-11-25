# Inner loop: placement + label invariants in seconds (fork-only, exp/city-loop-v5)

Runs the app's own placement code (`src/data/cityPlot.js` snapCityPlot/plotBlock,
`cityMassing.js` plotMassing, `cityGround.js` plotGround/districtGrounds,
`cityLocations.js` cityPlaceName, `cityGameHud.js` placeText — the functions the
globe adapters `src/standalone/cityPlay.js` / `cityMassing.js` and
`CityGameHud.vue` call) headlessly, with terrain injected, and checks:

- **I1** every footprint: 0 raster water samples and no shore crossing, inside its
  plot, yaw within 5° of the local street grid (OSM street orientation within
  150 m), base within 0.5 m of the terrain at its corners + centre, no overlap with
  an OSM building.
- **I2** the HUD place for a point at each location is that location's place
  (`Sausalito`, `San Francisco`), and `—` where nothing is known.

Cases per location (Sausalito/Dunphy Park, North Beach, Presidio): the capture's
hero journey (click the location's grid plot, shift-click its opposite plot →
growth district), 300 seeded random clicks, an exhaustive 5 m sweep of every plot
a click within 299 m can name, and 60 random districts between reachable plots.

```
downstream/city-loop/inner/prepare.sh                    # once: caches, outside git
node downstream/city-loop/inner/harness.mjs              # ~0.3 s; exit 0 = all hold
node downstream/city-loop/inner/harness.mjs --root ../other-checkout   # "before"
node --test downstream/city-loop/inner/parity.check.mjs   # Node checks == sanity_gate.py
node downstream/city-loop/inner/fit-grids.mjs northbeach presidio      # refit a grid spec
```

Terrain: USGS 3DEP (3DEPElevation ImageServer, public domain, NAVD88 m), fetched by
`fetch-dem.mjs` into `~/.cache/gev-dem` (`GEV_DEM_DIR`), never stored in git. The live
app does not use it: it still samples Cesium World Terrain / the diorama surface
at run time (ion terms forbid storing those heights, loop-v3/licence/REPORT.md);
the harness injects the USGS sampler into the same `plotGround` function.

Scope: the location model covers the 300 m claim of each fitted grid
(`src/data/cityGridSpecs.js`). Outside every claim the global 40 m lat/lon grid
still answers and still fails I1 (try `--radius 450`).
