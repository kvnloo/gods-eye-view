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
- **05 Toybox** — existing GLSL looks, nine curated creative grade packs, and explicit camera trips

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

Run `node scripts/qa-playground-looks.mjs` with the dev server running to
check the creative gallery, GLSL stage reuse, persistent disclosure, reset and
comparison screenshots. Software WebGL proof is **not** a GPU performance result.

In a browser, select EXPLORE, visit all five tabs, launch the Nepal scene,
seek its authored timeline, add/undo a hypothetical marker, join the same room
in two same-origin tabs (no automatic camera sharing), and choose a sensor look.
Also verify Escape, mobile layout, and `?embed=1` without a launcher.

**Not implemented:** remote internet rooms, global time travel, SUMO/PyPSA
impact forecasts, operational disaster guidance. Keep provenance and simulated
states explicitly separated.

## Visual Universe (experimental)

The Toybox imports `lookPacks.js` as a **data-only** curated look catalog. A
single static GLSL post-process color grade is initialized only when needed and
owned by the Playground lifetime. Original Earth and the existing GEV styles
remain available. No third-party shader source, scripts, fonts, assets, network
downloads, account state, or persistent background GPU loop are introduced.

The built-in looks are creative treatments of rendered pixels, **not** changes
to factual geographic data, lighting models, source imagery, weather, materials,
or measured thermal signatures. Genre names describe an aesthetic, not licensed
game assets. Grades remain session-only in this first slice; only existing GEV
style controls continue to use normal share links. Browser GPU/frame-time proof
and screenshot A/B inspection are required before origin promotion.

Next, if this pilot proves useful, extend existing share/Scene serialization
with versioned, bounded grade parameters and a default-off creative marker.
Community submissions should be curated signed/data-only manifests with author
credit, explicit asset rights, compatibility/performance receipts, rollback, and
unmodified Earth comparison; do not permit arbitrary downloaded GLSL or runtime
code from catalog listings.


## Authored look manifests (draft v1)

`lookManifest.js` is a **pure JSON boundary**, not an installation service.
It accepts a bounded `gev.visual-look.v1` record with `creative: true`,
a recognized base renderer style, seven bounded grade controls, and required
`author.name` / `author.basedOn` provenance. Imported documents can contain
neither shaders nor JavaScript, external URLs, unknown properties or license
claims. Export normalizes every control and serializes it deterministically.
The optional **Local Look Lab** inside the Toybox exports a credited curated
creative look into a manually copyable JSON text area and applies validated
local JSON to the same owned grade stage. Imported titles and author names
are rendered as text, never HTML. Invalid JSON leaves the previous look
unchanged; the persistent CREATIVE indicator carries the imported author.

**No remote packs, code execution, automatic clipboard, persistent storage, or
share-link integration** is introduced. Grade comparison is temporary preview
state, not part of exported manifests.

The focused contract is `node --test src/playground/lookManifest.test.mjs`.
After source-only V8 verification, a real Node 24 run remains in #72.


## Creative grade comparison

The Toybox Compare slider is a one-pass split of the **same** Cesium scene:
the left side shows the creative grade and the right side retains the
selected native GEV base lens. It does not render another scene, create a
history buffer or change map picking, and at 0% the optional grade stage
is disabled. Choosing another look resets the split to 100%; closing the
Toybox retains the split until the user changes or clears the look. For
anime/snow/surveillance, the right side is that *base lens*, **not** raw
Original Earth. The browser acceptance script also captures a 50/50 frame.

The browser QA for this slice confirms a named author, one changed grade
parameter, persistent CREATIVE disclosure, and fail-closed rejection of
`fragmentShader` injection. See [downstream task #72](https://github.com/kvnloo/gods-eye-view/issues/72)
for native runtime and GPU acceptance before origin promotion.
