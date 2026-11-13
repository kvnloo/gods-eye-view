# City builder massing v0

Massing v0 adds an **assumed** building block to the plot selected in City
builder play mode ([CITY-BUILDER.md](./CITY-BUILDER.md)). It is an estimate
for thinking about scale, never a design, a permit, or a city's zoning.

## Turning it on

The feature is behind a URL flag and off by default: add `?massing=1` to the
app's URL. Without the flag nothing is mounted: no entities, no shadows, no
probe.

## What it shows

Select a plot in play mode. A **MASSING** toggle appears beside the plot,
clear of the wheel, the plot tag, the resource bar, the map credits and the
docks. Turn it on and the plot gets:

- a **ground plate** over the whole 40 m plot, from below the lowest sampled
  ground to 0.1 m above the ground at its centre, so it never floats over a
  slope and never z-fights the globe;
- a **block** on the plot inset by the setback, standing on the sampled ground
  at the plot centre (or on the street when the centre sample hits a roof),
  height = storeys x storey height;
- a **cast shadow** from the scene sun (the scene clock's sun, the same one
  Cesium lights the globe with): the scene shadow map is on while the block
  shows, only when the sun is above the horizon. The globe receives it, with
  soft (filtered) edges so it reads as a band on the ground. Cesium's default
  sun shadow map (4 cascades of 2048 x 2048 texels) resolves it: the journey
  measures the 45 m band of a 19 m block at a 23° sun. All of it is restored
  when the block hides.

The app renders on demand and entity geometry builds over several frames, so
after every change (MASSING on, the stepper, a new ground) massing keeps frames
coming until the plate and block are drawn as they now stand (at most 20 s);
the block and its shadow appear together, not on the next camera move.

On 3D tiles (Google photorealistic) the plot is cut out of the mesh with a
`ClippingPolygonCollection`, so the block never intersects the real building;
the plate fills the cut at street height and the mesh takes the block's shadow
without casting its own (its light is baked in). The cut joins any existing
clipping and is removed when the block hides.

The block hides in the district tier and while Reimagine captures and
generates, so a concept is made from the plot as it is.

## The readout

`src/ui/views/panels/CityMassingReadout.vue` stands beside the plot in the
play-mode HUD glass: **HEIGHT** x m with an **EST** chip (its tooltip names the
assumed storey height and setback), **STOREYS** with a - / + stepper,
**FAR** (computed), **FLOOR AREA** in m², **HOMES** with an **EST** chip
(its tooltip names the assumed residential share and home size) and **SHADOW
REACH** in whole metres with an **EST** chip (height ÷ tan(sun altitude) on
level ground, the sun altitude in its tooltip). The stepper recomputes every
row and re-extrudes the block; SHADOW REACH also follows the scene clock's sun.
That is three controls: the toggle and the two stepper buttons; HOMES and
SHADOW REACH add none. The readout is placed with play mode's `placeBeside` beside the
block, its cast shadow, the wheel and the HUD; when the plot fills the view and
no spot is clear it is clamped on screen, so the toggle stays reachable. On a
phone it wraps into two lines to fit the band left by the wheel, and HOMES and
SHADOW REACH stand in a one-line strip of the same glass above the plot tag
(the band under the wheel holds only two lines).

The globe owner publishes the readout's numbers and the screen points of the
block and its shadow through the play store (`massing`, `massingAnchors`,
`massingControls`); all three stay null without the flag.

The block follows the map under it: once the framed tiles load (after a zoom
or a flight) the ground is measured again and the block moves if it is 0.5 m
or more off; a switch between the globe and photoreal tiles cuts and grounds
it again.

## Numbers

`src/data/cityMassing.js` (pure, application-owned) computes from the plot
polygon and three assumptions:

| assumption    | default | meaning                              |
| ------------- | ------- | ------------------------------------ |
| storeys       | 6       | whole storeys, 1 to 60               |
| storey height | 3.2 m   | floor to floor                       |
| setback       | 4 m     | every plot edge moves inward by this |
| res share     | 0.64    | residential share of the floor area  |
| home size     | 85 m²   | floor area of one home               |

- plot area: the polygon's area in the plot grid's own metric, so a grid plot
  is exactly its 40 m x 40 m cell (1,600 m², the area the zoning legend shows);
- footprint area: the inset polygon's area (32 m x 32 m = 1,024 m²);
- floor area = footprint area x storeys;
- FAR = floor area / plot area;
- height = storeys x storey height;
- site coverage = footprint area / plot area (0.64 by default, 0.7225 with a
  3 m setback: a separate number from the residential share, though both are
  0.64 by default);
- homes = floor(floor area x residential share / home size): 46 at 6 storeys,
  61 at 8.

`src/data/__fixtures__/massing-golden.json` holds these constants and the
expected cases (6 and 8 storeys, a 3 m setback, and SHADOW REACH at three sun
altitudes). `cityMassing.test.mjs` and `citySun.test.mjs` hold the code to it,
and the dream loop's planspec validator reads the same file.

A setback that leaves no footprint leaves no block: those values are null,
never zero.

## Sun and shadow

`src/data/citySun.js` (pure) gives the sun over the plot and the shadow:

- `sunPosition(lat, lon, utcMs)`: altitude (geometric elevation) and azimuth
  clockwise from north, from the app's existing solar position
  (`observerSolarPosition` in `src/data/satellitePass.js`);
- `shadowReach(height, sun)` = height / tan(altitude) on level ground, null
  when the sun is down;
- `shadowTip(footprint, height, sun)`: the footprint moved that far away from
  the sun (azimuth + 180°).

`src/data/citySun.test.mjs` holds the sun to independent references at three
UTC times over the journey's plot: NREL SPA (Reda and Andreas, NREL/TP-560-34302,
via pvlib-python 0.13.1, which reproduces the report's published example) and
the NOAA Solar Calculator, each within 1°; and to Cesium's own scene sun
(UniformState's Simon 1994 sun) within 1°.

## Persistence

None. Massing is computed on load from the plot and never written to the city
document or local storage; `src/testSupport/cityDocumentSavedKeys.txt` does not
change. After a reload the block is recomputed from the defaults.

## Regression journey

`scripts/qa-city-massing.mjs` drives the flag-on journey against a running dev
server (the gate runs every `scripts/qa-city*.mjs`; `scripts/qa-city-play.mjs`
stays the flag-off journey, unchanged). `QA_PLOT=<plot id>` picks the plot; the
default, `plot-n105201-126637`, holds Saints Peter and Paul Church on
Washington Square, San Francisco, a building on the Esri imagery and on
Google's 3D tiles. The camera looks north at the plot from 600 m. It pins the
scene sun through the page's world clock and, at 1440x900:

1. selects the plot by clicking its centre: one MASSING toggle, no block yet;
   zones the plot (the legend shows its 1,600 m²) so a saved document exists;
2. samples the ground at the plot centre and on the street outside each edge
   **before** MASSING turns on (on 3D tiles the cut leaves nothing to sample);
   with MASSING on, the drawn block's base is within 0.5 m of that ground (the
   lowest street sample when a structure stands on the plot), and the drawn
   plate reaches below it. On 3D tiles every shown tileset is cut and nothing
   of the mesh stands above the base inside the plot;
3. measures the cast shadow: ground inside the expected shadow is darker with
   the shadow map on than off, the sun side is not. Each capture is the canvas
   read inside the `postRender` of a frame the journey asked for
   (`scene.requestRender()`). If the on and off captures come from one frame or
   are byte-identical, or the shadow map was not on then off when the frames
   were drawn, the run is **INVALID** (exit 3), neither a pass nor a shadow
   failure. `03b-shadow-crop.png` shows the block and its shadow from the on
   and the off frame side by side, and a profile records the on/off ratio
   every 0.5 m along the line away from the sun, on the ground the map shows.
   Cesium's scene sun (`uniformState.sunDirectionWC`) is within 1° of the
   massing sun, and the rendered shadow ends within max(1 m, 5 %) of
   height / tan(altitude), height being the block top above the ground at the
   tip (the ground may slope);
4. reads the readout (19.2 m EST, 6, 3.84, 6,144 m²), counts three controls,
   checks it covers no block corner, shadow point or HUD element, and audits
   legibility (4.5:1, 12 px caps);
5. steps +2: 25.6 m, 8, 5.12, 8,192 m², the block entity re-extruded,
   ground between the 6- and 8-storey shadow tips goes from lit to shaded, the
   rendered shadow again ends within max(1 m, 5 %) of the formula and is
   1.333 ±5 % times as long as at 6 storeys;
   the saved document is byte-for-byte unchanged;
6. closes the page and opens a fresh one: zoning is restored from the save,
   massing starts again from the defaults (recomputed, not restored);
7. at 390x844 steps once more: the readout fits, works and covers neither
   the HUD nor the block and its shadow;
8. opens the app without the flag: no readout, entities, shadows or probe.

With `QA_VIDEO_DIR` set, each page's video is written as an MP4, and the
journey cuts a 30 s `demo.mp4` from the journey page alone (no loading splash):
the plot selected, MASSING on with its shadow band, then +2 storeys with every
row changing and the shadow lengthening. Its cut comes from marks on the
journey page's video clock and leaves out every frame a capture drew with the
shadow map off (`demoCut` in `scripts/qa-massing-measure.mjs`).

`src/tooling/qaCityMassingJourney.test.mjs` fails if any of these steps drops
out of the journey.
