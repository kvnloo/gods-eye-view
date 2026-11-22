# downstream/city-loop (fork-only)

Nothing in this folder, and nothing in the last commit of `city/consolidated`
("spike(city): GLB stand-in and 3D-tile seating harness"), is meant for
upstream bilawalsidhu/gods-eye-view. Every commit before it is.

## The spike harness

`src/standalone/cityMassing.js` (the `SPIKE` blocks) and
`src/standalone/cityMassingSeat.js` read an optional
`public/city-massing-spike/arm.json`. No arm.json is committed; without one the
massing block is drawn as the product commits draw it.

Minimal arm, one GLB for the 6-storey block, its own shadows on:

```json
{ "models": { "6": "/city-massing-spike/block-6.glb" }, "shadows": "ENABLED" }
```

Keys the harness reads (see the comment block at `SPIKE_ARM` in
`cityMassing.js` for each one's meaning): `models`, `shadows`, `options`,
`sun`, `env`, `shade`, `tilesSun`, `grade`, `view` (`sun`, `light`) and
`seat` (`level` 1-5, `tone`, `steps`, `cut`, `keeps`, `knee`, `under`,
`self`). GLBs are in metres around the footprint centre, base at 0, Blender
export axes (east +X, up +Y, north -Z).

## Running the city builder for the loop

- Open the app with `?massing=1` for massing, sun/shadow study, FIT TO SUN and
  the growth timeline; the City builder pill (top centre) enters play mode.
- Google photoreal tiles need `CESIUM_ION_TOKEN` (env or Provider Settings).
- Browser journeys: `node scripts/qa-city-play.mjs`, `qa-city-massing.mjs`,
  `qa-city-builder.mjs`, `qa-city-sites.mjs` against a running dev server
  (`--url http://127.0.0.1:4187`).
