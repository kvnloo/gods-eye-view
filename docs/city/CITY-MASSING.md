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
  height = storeys x storey height, drawn as a building (see
  [The look](#the-look));
- a **cast shadow** from the scene sun (the scene clock's sun, the same one
  Cesium lights the globe with): the scene shadow map is on while the block
  shows, only when the sun is above the horizon. The globe receives it, with
  soft (filtered) edges and a darkness of 0.4 (Cesium's own 0.3 is harsher
  than the shadows already in aerial imagery), so it reads as a shadow on the
  ground. Cesium's default sun shadow map (4 cascades of 2048 x 2048 texels)
  resolves it: the journey measures the 45 m band of a 19 m block at a 23°
  sun. All of it is restored when the block hides.

While a block stands, play mode's selection prism (the translucent box drawn
while a plot is being chosen) steps aside, as it does for a concept; the plot
outline on the ground stays.

The app renders on demand and entity geometry builds over several frames, so
after every change (MASSING on, the stepper, a new ground) massing keeps frames
coming until the plate and block are drawn as they now stand (at most 20 s);
the block and its shadow appear together, not on the next camera move.

On 3D tiles (Google photorealistic) the plot is cut out of the mesh with a
`ClippingPolygonCollection`, so the block never intersects the real building;
the plate fills the cut at street height and the mesh takes the block's shadow
without casting its own (its light is baked in). The cut joins any existing
clipping and is removed when the block hides.

The mesh is a hollow shell, and a 40 m grid cell is not a parcel: the cut can
slice a neighbour in two and can leave the plate below the ground around it.
So that the cut never shows the sky through the mesh, two things hold while
the block stands (both restored when it hides):

- the mesh is drawn with its inside too (`backFaceCulling` off);
- a blank wall closes the cut along the plot's edge, from the plate up to the
  mesh sampled every 4 m, 1 m outside the edge. A height counts only when the
  samples on both sides reach it too, so a neighbour raises a party wall and
  a lone tree or pole does not. The wall takes the block's shadow.

A neighbour as tall as the block can stand between it and the street: the
block's shadow then lies on that neighbour's walls, as it would, and the
level-ground reach in the readout is not where it ends.

The block hides in the district tier and while Reimagine captures and
generates, so a concept is made from the plot as it is.

## The look

The block is an estimate, and it is drawn as a building so its size reads
against the city: a look, never a design. `src/data/cityMassingFacade.js`
(pure; fixed table in `src/data/cityMassingFacade.test.mjs`) lays it out from
the massing's own numbers:

- one floor band per storey, each the massing's storey height;
- the ground band is a shopfront (three lights to a bay, a door in the middle
  bay, a plinth and a sign band); every band above it is a floor of windows
  with stone surrounds;
- each wall is divided into whole window bays (a 32 m wall has ten of 3.2 m);
- the parapet is the top 0.58 m of the top band, never above it, so the top
  of the building is the massing height and every shadow number holds;
- solid colours in the app's palette (stone, slate frames, an amber sign
  band). Cyan stays the plot outline.

`src/standalone/cityMassingLook.js` draws it as a Cesium fabric material on
the block's own polygon (the plate uses the same material and comes out as
paving, darker where the walls stand). A polygon's texture coordinates carry
no height, so the shader places each fragment in metres east/north/up of the
footprint's middle, relative to the eye. It is opaque and lit by the scene
sun; faces turned from the sun keep half their colour as skylight. The block
casts its shadow and receives none (a shadow map speckles a lit roof that it
falls back on); the paving under it and the map take the shadow. The roof
has a coping, the parapet's shade on the side the sun comes over, a stair
core and three units. Those are painted as the eye sees them: they are not
geometry and add nothing to the height or to the cast shadow. A thin light
along the roofline and the corners marks the building as a proposal.

Limits: a footprint's first four walls are laid out (a plot footprint has
four); nothing is modelled inside or behind the glass; the facade does not
know the street, so every wall gets a shopfront.

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
expected cases (6 and 8 storeys, a 3 m setback, and three SHADOW REACH cases
at two sun altitudes). `cityMassing.test.mjs` and `citySun.test.mjs` hold the
code to it, and the GEV-CITY dream loop's planspec validator (outside this
repository) reads the same file.

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

## Protect a sidewalk from the shadow

With MASSING on, a second panel beside the readout holds one toggle, **PROTECT
SIDEWALK**. It is off by default and draws nothing until it is on. On, it holds
the block's shadow against a protected edge across the street: the far
sidewalk.

- **The edge.** Its distance is measured from the face of the block that the
  shadow leaves, along the shadow. It starts at 20 m and reads **ASSUMED**
  until the player sets it: **SET ON MAP** takes the next click on the ground
  (play mode hands that one click over instead of selecting a plot), and the
  − / + stepper moves it a metre at a time (the keyboard path). The distance is
  kept in whole metres, 1 to 200. A click on the block or behind that face
  sets nothing and leaves the tool armed.
- **The sun.** The study uses the scene clock's sun, the same one that casts the
  block's shadow. Outside winter (December to February north of the equator,
  June to August south of it) it offers **WINTER NOON**, which moves the scene
  clock to solar noon on the winter solstice of the scene's year at the plot:
  the minute `citySun` puts the sun highest (28.8° at San Francisco). No sun
  angle is typed in or assumed. With the sun down the reach is a dash and there
  is nothing to fit.
- **On the ground.** The shadow itself is the one the block casts (the scene
  shadow map), so it follows the ground and stops short where a street rises.
  Over it lie thin lines, clamped to the ground on the globe. On 3D tiles a
  ground line smears down every wall it meets, so there each line runs level,
  half a metre over the block's base, and shows faintly where a building or
  rising ground stands in front of it. The lines are: the protected edge in amber,
  reaching 6 m past the shadow's sides; a solid line where the shadow now ends
  on level ground (NOW); and a dashed one: before a change, where a fit would
  leave it (FIT TO SUN); after one, where the shadow of the storeys the study
  started from ended (WAS). Each line ends in a tip label, worded
  by `src/ui/cityShadowTip.js` through `hudFigure`:
  `SHADOW WAS 35 m · 15 m ONTO SIDEWALK EST`,
  `SHADOW NOW 17 m · CLEARS SIDEWALK BY 3 m EST`.
- **FIT TO SUN** sets the storeys to the most that still clear the edge. It
  only ever cuts: a block that already clears keeps its storeys and the button
  is disabled. It never goes below one storey; when even one storey reaches the
  edge the panel says so. It changes the storey count, never the storey height
  (floor-to-floor is held to 2.8 to 4.5 m; massing's own is 3.2 m).
- **Readouts.** FLOORS `6 → 3 EST`, and ONTO SIDEWALK or CLEARS SIDEWALK BY in
  metres EST. Once the storeys changed, one line states what that cost:
  `HOMES 46 → 23 EST · FAR 3.84 → 1.92`, the massing readout's own HOMES and
  FAR for the storeys the study started from and for the ones that stand. The
  massing readout itself follows with HEIGHT, FAR, HOMES and SHADOW REACH.

`src/data/cityShadowFit.js` is the one owner of the numbers (pure):
`shadowFit({storeys, wasStoreys, storeyHeightMeters, sun, edgeMeters})` returns
the `now`, `was` and `fit` lines (storeys, height, reach, and reach − edge), the
two lines to draw, `canFit` and `cannotClear`; `shadowBand` and `edgeDistance`
are the ground geometry; `winterNoon` and `inWinter` are the winter study
moment. `src/data/cityShadowFit.test.mjs` is a fixed table: six storeys of
3.0 m under a 29° sun against an edge 20 m away reach 32.5 m, 12.5 m onto it,
and fit to three storeys, 16.2 m, clear by 3.8 m.

While the study is on the play wheel steps aside (its ring is as wide as the
shadow it would cover); PROTECT SIDEWALK off brings it back.

These are estimates on level ground from the block's height and the sun: no
neighbouring buildings, trees, slope or roof shape, and one moment, not a day
or a season. The edge is where the player put it, not a surveyed kerb. The
study is desktop only (a phone keeps the massing readout alone), and nothing
of it is saved.

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
3. reads the building off the canvas: the block's material is the facade,
   it has a band per storey with a shopfront at the ground, a line of pixels
   along the wall facing the camera crosses one dark run per window bay while
   the wall under the windows is plain, and play mode's selection prism is
   not drawn (`02b-building.png`);
4. measures the cast shadow: ground inside the expected shadow is darker with
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
5. reads the readout (19.2 m EST, 6, 3.84, 6,144 m²), counts three controls,
   checks it covers no block corner, shadow point or HUD element, and audits
   legibility (4.5:1, 12 px caps);
6. steps +2: 25.6 m, 8, 5.12, 8,192 m², the block entity re-extruded,
   ground between the 6- and 8-storey shadow tips goes from lit to shaded, the
   rendered shadow again ends within max(1 m, 5 %) of the formula and is
   1.333 ±5 % times as long as at 6 storeys;
   the saved document is byte-for-byte unchanged;
7. closes the page and opens a fresh one: zoning is restored from the save,
   massing starts again from the defaults (recomputed, not restored);
8. at 390x844 steps once more: the readout fits, works and covers neither
   the HUD nor the block and its shadow;
9. opens the app without the flag: no readout, entities, shadows or probe.

With `QA_VIDEO_DIR` set, each page's video is written as an MP4, and the
journey cuts a 30 s `demo.mp4` from the journey page alone (no loading splash):
the plot selected, MASSING on with its shadow band, then +2 storeys with every
row changing and the shadow lengthening. Its cut comes from marks on the
journey page's video clock and leaves out every frame a capture drew with the
shadow map off (`demoCut` in `scripts/qa-massing-measure.mjs`).

On its own page, looking south so the north-falling shadow lies in front of
the block, the journey then protects the sidewalk: MASSING on at six
storeys, PROTECT SIDEWALK, WINTER NOON (the scene sun must come within 1° of
28.8°), the edge moved to 23 m with the stepper from the keyboard, then set
back to 20 m by SET ON MAP and a click on the ground across the street. It
asserts the panel, the two tip labels and the entities on the ground against
`shadowFit` (each line's length within half a metre), takes
`09-shadow-reaches.png`, presses FIT TO SUN and asserts three storeys, the
dashed WAS line, the NOW line, `FLOORS 6 → 3 EST`, the cost line
(`HOMES 46 → 23 EST · FAR 3.84 → 1.92`), the massing readout (23 homes, FAR
1.92) and that nothing was saved (`10-fit-to-sun.png`). Last it measures the
shadow under the study: ground inside the NOW band is at least 25 % darker
with the shadow map on than off, a band beside it is not darkened, and NOW is
a line, not a filled patch (`11-cast-shadow-study.png`).

`src/tooling/qaCityMassingJourney.test.mjs` fails if any of these steps drops
out of the journey.
