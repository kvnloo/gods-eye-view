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

The opt-in query is an **exact match** (`?planningPreview=fixture` only); normal startup does not import the preview. Additional parameters, repeated `planningPreview` keys, or differently encoded values do not mount fixture UI. The real-browser QA gate imports the actual bootstrap query predicate and checks positive/negative query cases; this source-level contract is **not** proof that the full browser QA ran. The preview button mounts within the existing Scene panel after startup and is removed when the application is destroyed.

The demo composes a synthetic reference-only parcel and two distinct author operations through the existing `collaborationAuthority.js` kernel. It shows "Trees & shade" (recorded actor `alice`) beside "Play & community garden" (recorded actor `bob`), with schematic markers normalized to the authored fixture bounds, assumptions, and explicit `not-evaluated` and `not-requested` labels. Credit is the **recorded operation actor ID, not verified real-world identity**.
The Scene preview also prints the synthetic baseline source's ID, fixture revision,
attribution, license and URL as **plain text**, never fetched or interpreted as
verified land ownership. Missing source records are explicitly marked unverified. The preview also discloses how many authored planning records the projection excludes as stale or incompatible, plus how many valid alternatives fall outside its two-card display. These are snapshot counts, **not conflict detection**: the existing deterministic merge projection retains a winner but cannot reconstruct overwritten edits. No operation history, remote identity or review approval is inferred. The excluded-record disclosure now labels **one directly observable reason** (wrong project/proposal ID, wrong baseline revision, missing payload, wrong record ownership, unsupported schema revision, non-hypothetical state, asserted impact, or unverified approval claim) using fixed text, while hiding malformed proposal IDs. Reasons are not exhaustive: a single imported record can fail several rules, and this does not recover overwritten edits or prove a real collaboration conflict. A pinned synthetic browser QA case exercises each reason and checks that rejected impact/approval payload text is not displayed; the actual full-app browser gate remains **NOT RUN**. These fixed rejection reasons cannot authenticate a purported official approval or establish an environmental/traffic benefit.

If only one or no valid alternatives survive validation, the Scene panel visibly
says comparison is unavailable and disables Game view. Excluded stale snapshots
must not masquerade as competing proposals. The Puppeteer gate exercises both
one-valid and zero-valid negative fixtures without any real place or transport.

`Co-op view` shows both proposals side by side; `Game view` focuses one proposal at a time, with keyboard-accessible `Inspect` controls to switch between them. A native keyboard activation of Game view hands focus to the selected newly visible Inspect control; pointer/touch mode changes retain focus on the mode control. When a scripted or touch-like Co-op transition leaves focus in Inspect, focus is moved to the visible Co-op control before Inspect is hidden; an already focused mode control is left alone. The pinned Puppeteer QA covers these negative/positive paths, but an actual full-app browser run remains **NOT RUN**. This is a **local, reversible presentation choice**, not a simulation or scoring mechanic. Neither adds points, votes, municipal approval, a site suitability claim, a model prediction, a route, a signal controller, or writes to GEV observed data. There is no real parcel, no live collaborative service, no GIS survey accuracy, no profile location inference, and no map/satellite tile redistribution. The plot is an approximate SVG schematic, not a geospatial basemap.

## Safe Scene dialog teardown

The opt-in Scene launcher owns at most one planning dialog. If the shared
dialog's native close path throws, the preview wrapper logs the failure, removes
the stranded modal element, releases its own dialog ownership and permits
reopening. Cancel restores focus only when the launcher is still mounted.
Destroying the Scene host removes the launcher idempotently; clicking an old
detached launcher cannot reopen a hypothetical preview.

The pinned Puppeteer gate now injects a synthetic close failure against the
mounted Scene dialog, followed by reopen, ordinary close, host teardown and
stale-launcher negative controls. **That full-app browser gate has NOT RUN.**
An isolated exact-source V8 adapter reproduced the old stuck owner and
confirmed the new recovery behavior, but is not Node, Cesium, Puppeteer,
device or app-startup evidence.

## Gates

```sh
node --test src/standalone/communityPlanningFixture.test.mjs
# With the actual GEV dev server from this checkout already running,
# supply the independently read-back FULL head SHA of fork Draft #229:
GEV_QA_EXPECTED_SHA=<full-40-character-pr-head-sha> node scripts/qa-community-planning-preview.mjs
```

The QA gate rejects unsupported Node engines and prereleases before checking out source identity or launching Chromium. Its built-in version negative controls reject Node 22, Node 24.13, Node 25, Node 27 and prereleases; Node 24.14+ and 26.x remain allowed. This is validation-policy enforcement, not a supported-runtime or live-app test result.

The QA gate uses the repository's existing Puppeteer dev dependency, opens the opt-in GEV URL, and checks that two branches, 5 markers, two recorded actors, no official approvals, and mode toggling/focused-card switching/restoring both cards/close behavior are present.

It fails closed before launching Chromium if the pinned full SHA does not match the local Git HEAD or tracked/untracked (non-ignored) files are present. Untracked source files are explicitly rejected: `git status --porcelain --untracked-files=no` would silently miss them. Ignored local `.env` files and installed dependencies are outside this working-tree check; they are not a claim of reproducible runtime configuration. Once the app loads, Vite `?raw` module responses for **six** directly involved source owners — planning data, collaboration merge kernel, fixture, standalone opt-in bootstrap, Scene preview and shared Scene dialog — are compared byte-for-byte against that checkout. The gate self-tests three missing-runtime-owner negative controls before launching Chromium. A server with stale/different code in any of those six modules cannot pass as exact-head evidence; unrelated dependencies and runtime assets remain outside this scoped source check. Before any desktop or mobile navigation reaches the network, the QA runner intercepts top-level document requests: a redirect to another origin, a different loopback alias, or any unpinned same-origin path/query (including credential-shaped parameters) is aborted, rather than only detected after the request. Provisional navigation requests with no bound frame are also denied when the URL is unpinned; recognized subframe navigation and non-document map assets remain outside this narrowly scoped gate. A synthetic no-frame negative control covers token-bearing and off-origin destinations, but only a live Chromium run can establish real Puppeteer interception behavior. The only permitted main-frame entries are `/` and `/?planningPreview=fixture` with no fragment or URL credentials. Synthetic request-interception negative controls distinguish the two pinned entries from same-origin token-bearing/wrong-fixture redirects, blocked remote navigation, and permitted non-navigation map assets. This guard does not attest to external subresources or iframe destinations; it is **not** evidence of a live browser run.

A final HEAD/clean-state check catches source drift during the browser run. An explicit pinned SHA from the GitHub PR readback is required; deriving the target from whatever happens to be checked out would not verify the requested branch. This only checks source identity and the exercised Scene: it does not prove a production bundle, true two-browser collaboration, a supported device, or official approval.

A separate isolated Chromium smoke test of the preview DOM with a **stubbed planning-data adapter** passed: 2 hypothetical cards, author credits, schematic markers, local mode toggle and teardown. That test does **not** prove complete real-app startup, two-browser sync, or production bundle behavior; the actual GEV browser gate above must pass before further promotion.

## Later work

Only after a validated field problem and an authorized source: map real rights-checked parcel geometries, add accessible public input, test real-time shared revisions/offline reconnect, and compare proposals with independent urban accessibility/traffic/climate models. Unverified feasibility and estimates remain unknown. Coordinate with #65/#73 and #145 rather than duplicating their ownership.

Credits: GEV's Bilawal Sidhu and contributors own the app and Scene UI; the existing co-op planning and collaboration contracts come from downstream #164/#185 and their authors; the city-planning direction came from Kevin Rajan. This narrow browser-preview prototype and tests were prepared with ChatGPT.
