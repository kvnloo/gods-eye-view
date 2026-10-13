# Co-op park planning — opt-in GEV browser preview (synthetic)

This is a fork-only, single-browser UI proof for downstream [#184](https://github.com/kvnloo/gods-eye-view/issues/184), stacked on the shared collaboration [#164](https://github.com/kvnloo/gods-eye-view/pull/164) and park proposal [#185](https://github.com/kvnloo/gods-eye-view/pull/185). It uses the existing GEV Scene dialog and the real `planningView()` projection, not a new collaboration transport or a second authoritative map.

## Try it

From a standard GEV development checkout on supported Node 24.14.x/26.x:

```sh
npm install
npm run dev
# In a browser: http://localhost:4173/?planningPreview=fixture
# Open the SCENES panel and click COMPARE PARK PROPOSALS · FIXTURE
```

The opt-in query is an **exact match**; normal startup does not import the preview. The preview button mounts within the existing Scene panel after startup and is removed when the application is destroyed.

The demo composes a synthetic reference-only parcel and two distinct author operations through the existing `collaborationAuthority.js` kernel. It shows "Trees & shade" (recorded actor `alice`) beside "Play & community garden" (recorded actor `bob`), with schematic markers normalized to the authored fixture bounds, assumptions, and explicit `not-evaluated` and `not-requested` labels. Credit is the **recorded operation actor ID, not verified real-world identity**.

`Game view` and `Co-op view` switch **local presentation only**; neither adds points, votes, municipal approval, a site suitability claim, a model prediction, a route, a signal controller, or writes to GEV observed data. There is no real parcel, no live collaborative service, no GIS survey accuracy, no profile location inference, and no map/satellite tile redistribution. The plot is an approximate SVG schematic, not a geospatial basemap.

## Gates

```sh
node --test src/standalone/communityPlanningFixture.test.mjs
# With the actual GEV dev server already running:
node scripts/qa-community-planning-preview.mjs
```

The QA gate uses the repository's existing Puppeteer dev dependency, opens the opt-in GEV URL, and checks that two branches, 5 markers, two recorded actors, no official approvals, and mode toggling/close behavior are present.

A separate isolated Chromium smoke test of the preview DOM with a **stubbed planning-data adapter** passed: 2 hypothetical cards, author credits, schematic markers, local mode toggle and teardown. That test does **not** prove complete real-app startup, two-browser sync, or production bundle behavior; the actual GEV browser gate above must pass before further promotion.

## Later work

Only after a validated field problem and an authorized source: map real rights-checked parcel geometries, add accessible public input, test real-time shared revisions/offline reconnect, and compare proposals with independent urban accessibility/traffic/climate models. Unverified feasibility and estimates remain unknown. Coordinate with #65/#73 and #145 rather than duplicating their ownership.

Credits: GEV's Bilawal Sidhu and contributors own the app and Scene UI; the existing co-op planning and collaboration contracts come from downstream #164/#185 and their authors; the city-planning direction came from Kevin Rajan. This narrow browser-preview prototype and tests were prepared with ChatGPT.
