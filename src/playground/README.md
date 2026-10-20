# Planet Playground

Optional EXPLORE panel built on the existing GEV controllers; no separate map or feed.

## Independent lanes

Each `features/NN-name.js` exports `feature = { id, title, mount({ root, services }) }`.
The mount function renders inside the provided panel and may return a cleanup callback.
The shell owns switching, keyboard dismissal and application-lifetime teardown.
Features must release their own event listeners, Cesium entities, timers, and opt-in connections.

- **01 Expeditions** — existing Nepal evidence scene; fire and traffic layer scout views
- **02 Time Machine** — authored SceneDirector clock only
- **03 What-if** — reversible A/B proposals, labeled hypothetical; no modeled outcomes
- **04 Multiplayer** — opt-in same-origin tab broadcast, not a remote presence server
- **05 Toybox** — existing GLSL looks and explicit camera trips

## Historical Earth (source-first pilot)

The Time Machine includes a separate **Historical Earth** place/year lens:

- Choose any globe center and an integer year from 4000 BCE to the current year
  (no year zero). The dated link opens [OpenHistoricalMap](https://www.openhistoricalmap.org/)
  in a separate tab or in a **user-initiated, sandboxed preview**. GEV's
  underlying terrain, imagery and live feeds **stay current**. The iframe
  makes a third-party map request only after an explicit *Preview dated
  map* or *Animate years* click, and unloads on date/location change or panel
  close. The animation uses OHM's documented `start_date`, `end_date` and
  signed year interval: at most 300 years per request and approximately 40
  animation frames. It never synthesizes terrain or historical positions.
- The first source-linked person-associated location is **Frederick Douglass's
  Cedar Hill residence** circa 1880. The [National Park Service](https://www.nps.gov/frdo/learn/historyculture/places.htm)
  documents the residence, **not** his presence, thoughts, or view at a
  particular instant. Coordinates are present-day site approximations.
- A dated OHM link is a **discovery interface**, not proof of map coverage at
  the selected coordinate/year. Individual OHM features can carry different
  [license and attribution terms](https://www.openhistoricalmap.org/copyright).
  No map data or media is copied into this pilot.

The time-animation embed contract comes from
[OpenHistoricalMap's embed specification](https://github.com/OpenHistoricalMap/openhistoricalmap-embed#dates).
Comparisons crossing BCE to CE are intentionally unsupported until a calendar
transition contract (including no year zero) is explicit. The third-party
preview is not a claim that data is present for either selected year.

This does **not** implement historical 3D reconstruction, an authentic first-person
reenactment, or location tracking of a historical person. Later slices can consume
georeferenced historical maps, source-bounded dated places, and documented
primary-source viewpoints with visible uncertainty and citations.

## Verification

Use Node.js 24.14 or 26:

```sh
npm ci
npm run format:check
npm run check:boundaries
npm test
npm run build
npm run dev
```

In a browser, verify Historical Earth Preview/Animate only fetches after a click,
changing either year unloads the iframe, the source link disappears outside
the documented association period, and closing Time Machine cancels only its
own in-flight camera motion. Verify keyboard/mobile input and the separate
OpenHistoricalMap link as well.

In a browser, select EXPLORE, visit all five tabs, launch the Nepal scene,
seek its authored timeline, add/undo a hypothetical marker, join the same room
in two same-origin tabs (no automatic camera sharing), and choose a sensor look.
Also verify Escape, mobile layout, and `?embed=1` without a launcher.

**Not implemented:** remote internet rooms, global time travel, SUMO/PyPSA
impact forecasts, operational disaster guidance. Keep provenance and simulated
states explicitly separated.
