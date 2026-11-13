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
  shows, only when the sun is above the horizon, and restored afterwards.

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
**FAR** (computed) and **FLOOR AREA** in m². The stepper recomputes all four
and re-extrudes the block. That is three new controls: the toggle and the two
stepper buttons. The readout is placed with play mode's `placeBeside`, so it
never covers the block, its cast shadow or the HUD; on a phone it wraps into
two lines to fit the band left by the wheel.

The globe owner publishes the readout's numbers and the screen points of the
block and its shadow through the play store (`massing`, `massingAnchors`,
`massingControls`); all three stay null without the flag.

## Numbers

`src/data/cityMassing.js` (pure, application-owned) computes from the plot
polygon and three assumptions:

| assumption    | default | meaning                              |
| ------------- | ------- | ------------------------------------ |
| storeys       | 6       | whole storeys, 1 to 60               |
| storey height | 3.2 m   | floor to floor                       |
| setback       | 4 m     | every plot edge moves inward by this |

- plot area: the polygon's area in the plot grid's own metric, so a grid plot
  is exactly its 40 m x 40 m cell (1,600 m², the area the zoning legend shows);
- footprint area: the inset polygon's area (32 m x 32 m = 1,024 m²);
- floor area = footprint area x storeys;
- FAR = floor area / plot area;
- height = storeys x storey height.

A setback that leaves no footprint leaves no block: those values are null,
never zero.

## Persistence

None. Massing is computed on load from the plot and never written to the city
document or local storage; `src/testSupport/cityDocumentSavedKeys.txt` does not
change. After a reload the block is recomputed from the defaults.

## Regression journey

`scripts/qa-city-massing.mjs` drives the flag-on journey against a running dev
server (the gate runs every `scripts/qa-city*.mjs`). It pins the scene sun
through the page's world clock, asserts the block base is within 0.5 m of the
ground sampled at the plot centre, and measures the cast shadow: ground inside
the expected shadow must be darker with the shadow map on than off, while the
sun side stays as bright. `scripts/qa-city-play.mjs` stays the flag-off
journey.
