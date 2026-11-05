# Community park planning: opt-in World Game preview (synthetic)

A fork-only, single-browser preview of the city-builder "World Game" comparison
(downstream #184). It renders two authored, hypothetical park proposals from the
shared collaboration kernel (`src/data/collaborationAuthority.js`) through the
real `planningView()` projection (`src/data/communityPlanning.js`). It adds no
transport, no persistence and no second map.

## Try it

```sh
npm install
npm run dev
# http://localhost:4173/?planningPreview=fixture
# Open the AUTHORING (Scene) panel and choose COMPARE PARK PROPOSALS · FIXTURE
```

Only the exact query `?planningPreview=fixture` loads the preview. Normal startup
imports none of its code.

## How it follows the UI rules

- `src/ui/communityPlanningPreview.js` owns the preview. It presents a plain view
  object to the Pinia store `src/ui/stores/communityPlanning.js` and answers
  `open`, `close`, `setMode` and `inspect` through the controls it connects.
  Teardown is idempotent, and a newer owner keeps the store.
- `src/ui/views/panels/CommunityPlanningPreview.vue` renders the launcher inside
  the Scene panel (`LayerPanelsView.vue`) and the modal through `<Teleport>` to
  the body. It uses `UiButton` and holds no application logic. The only
  imperative code moves focus: to the heading on open, to the launcher on close,
  to the chosen Inspect control when Game is entered from the keyboard, and back
  to Co-op before Inspect hides.
- Text goes through `t()` and `tn()`, and the owner presents it again when the
  locale changes. Every catalog carries the new entries.
- The comparison never opens over another Scene dialog (it reads the scene
  sharing store, not the DOM).

## What it shows

`Co-op view` puts both proposals side by side. `Game view` focuses one at a
time, with an Inspect control for each. Both views are local presentation: they
add no points, votes, approval, site suitability, prediction or write to GEV
data. Each card shows the recorded operation actor (not a verified identity),
the recorded edit, the source revision, a schematic marker plot (not a basemap),
and the labels `not-evaluated` and `not-requested`.

The preview prints the baseline source citation as plain, unverified text. It
counts the authored records the projection excludes and the valid proposals
beyond its two cards. For each excluded record it gives one fixed reason and
hides malformed IDs and rejected payload text. With one or no valid proposals it
says comparison is unavailable and disables Game.

## Gates

```sh
node --import=./build/registerVue.js --test src/ui/communityPlanningPreview.test.mjs
node --import=./build/registerVue.js --test src/ui/views/communityPlanningPreviewView.test.mjs
node --test src/standalone/communityPlanningFixture.test.mjs
```

The owner test covers presentation, negative fixtures (one valid, none valid, a
tampered approval claim, a malformed ID), the single-dialog rule and teardown.
The view test mounts the component over happy-dom: launcher, two cards and five
markers, Game/Inspect/Co-op, focus moves, Cancel and teardown.

Not run yet: a full-app browser pass on the dev server, and any device check.
The earlier Puppeteer gate (`scripts/qa-community-planning-preview.mjs` on
`exp/community-park-preview-20261013`) targeted the hand-written DOM version and
is not ported.

Credits: GEV's Bilawal Sidhu and contributors own the app and the Scene UI. The
co-op planning and collaboration contracts come from downstream #164 and #185.
The city-planning direction came from Kevin Rajan.
