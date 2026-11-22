# downstream/city-loop (fork-only)

Nothing in this folder is meant for upstream bilawalsidhu/gods-eye-view.

## The spike harness

The GLB stand-in and 3D-tile seating harness (commit `21c792b8a`,
`cityMassingSeat.js` and the `SPIKE` blocks in `cityMassing.js`, driven by an
optional `public/city-massing-spike/arm.json`) is on `city/consolidated`
only. It reached Cesium directly (including private fields), so
`city/renderer-port`, which draws the City builder through the renderer's
ports, does not carry it. Without an arm.json the harness drew the block as
the product commits do, which is what `city/renderer-port` draws.

## Running the city builder for the loop

- Open the app with `?massing=1` for massing, sun/shadow study, FIT TO SUN and
  the growth timeline; the City builder pill (top centre) enters play mode.
- Google photoreal tiles need `CESIUM_ION_TOKEN` (env or Provider Settings).
- Browser journeys: `node scripts/qa-city-play.mjs`, `qa-city-massing.mjs`,
  `qa-city-builder.mjs`, `qa-city-sites.mjs` against a running dev server
  (`--url http://127.0.0.1:4187`).
