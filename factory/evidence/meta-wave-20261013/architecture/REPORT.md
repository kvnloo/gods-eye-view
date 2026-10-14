# Architecture/performance independent qualification

## Outcome

**Existing owners remain the correct carriers. No new systemic unowned runtime defect was established; no implementation commit or remote write was made.** #881 and #889 deliver reproducible request-work reductions through production consumers. #879's optional budget works, but its default behavior is equivalent to main's existing 16-image bound; it is not evidence of a current unbounded-image leak or a measured default-memory improvement.

**Current-main integration is NOT merge-ready:** all three branches conflict with current main in CHANGELOG; #879/#881 also conflict in thumbnail tests. Combining #879+#881 requires preserving both new diagnostic methods. #889's boundary manifest is stale against current main: even after adopting its four manifest entries, `npm run check:boundaries` fails `Package boundary tools-services imports an unowned module: src/services/singleflight.js`. Route that adaptation to #889's existing owner, not a new competing carrier.

## Exact identities and scope

Repository: `bilawalsidhu/gods-eye-view`. Baseline/current main `132b9e96dc1491e5db8bf949b1560f4561c925c3`. Closing API verification at `2026-10-14T01:05:20.635072+00:00` again confirms all four identities unchanged (`closing-heads.json`).

This is AI-assisted independent qualification by Hermes, not a new implementation. Original project credit remains with Bilawal Sidhu and contributors including Sameh Khamis; the three examined PRs are authored by `kvnloo`. No attribution, maintainer approval or review authority is claimed for this lane.

| Candidate | Exact tested head | PR base / merge base against main |
|---|---|---|
| #879 byte-bound residency | `f96cd157f8f7f0c1b8dbf3440e638ba4c78820d3` | `e7707d9a0f34d9fbffc300023c319f95caa5be30` |
| #881 stale thumbnail cancellation | `85227cca9dc0fa74055c5f4e9490fea932f86875` | same |
| #889 terrain singleflight | `62159fd3546f41a54f7518ddf75c4c9170aacb86` | same |

`fresh-heads.json` and `final-heads.json` independently read the API before/after testing; main and all three heads were unchanged, all PRs open and GitHub mergeable=false. Owner is `kvnloo` on all three. No push/comment/review/Linear mutation occurred.

Own worktree: `<operator-worktrees>/gev-meta-wave/architecture`, detached main, finally clean. Exact-head source snapshots live in `head-879/`, `head-881/`, `head-889/`. Their common lock differs from main, so an exact-lock `npm ci --ignore-scripts` was installed in head-881 and shared only with the two lock-identical candidate snapshots. No claim that main's dependencies qualify old heads.

A temporary **integration experiment**, not an exact PR head, applied runtime changes to current main, retained both `memoryStats` and `refinementStats` at their only mutual runtime conflict, and adopted #889's official tests/manifest. Tree: `4f4931eb9dccd204478064e879176ef52e1bdb08`. Reproducible bytes are in `integration-adoption.patch`; all experiment changes were restored afterward. Wrapper receipt `head` fields name the checkout HEAD, so use this tree/patch for integration provenance and `snapshot-provenance.json` for exact-head runs.

## Full contract read and architecture constraints

Read all **5,194 lines** of `docs/CURRENT-STATE.md`, in consecutive ranges 1–600, 601–1250, 1251–1750, 1751–2250, 2251–2750, 2751–3250, 3251–3750, 3751–4250, 4251–4700, 4701–5194. Also printed every >2,000-character line's remainder beyond character 1,900, avoiding line truncation. SHA-256: `fae18df20c7418d3c05f28113a374583882847b71ad0da448637f087e1990c38`.

Read CONTRIBUTING, CODE-BOUNDARIES, package scripts and CI workflow. Relevant contracts:

- Existing code already has focused source/lifecycle extractions, explicit provider seams, instance-owned services and bounded caches. Module length and aesthetics are not defects.
- Recent Imagery belongs to an explicit acquisition source; application composition injects catalog, thumbnail and tile-template behavior. Rendering/layer code must not regain provider ownership. Main's injected-thumbnail regression remains passing under the integration experiment.
- Worldview `Data-Present`, not HTTP 200 or catalog appearance, proves pixels. Probe metadata survives decoded-residency eviction; `get` is not an LRU use. Three active thumbnail fetches and 16 resident image URLs are already bounded on main.
- Current viewport/focus refinement must retain pins/previews/followed candidates. Disable clears acquisition and URLs; ownership stays with the renderer's original collection when hosts change. At most two imagery drapes; comparison lease and swipe ownership must be released.
- Terrain uses normalized five-decimal points, sequential 64-point chunks, bounded 20,000-entry cache, finite real-ground provenance distinct from geoid fallback, cooldown/retry and lifetime clearing. Singleflight is equivalent *concurrent* query coalescing, not permanent caching or normalization of differently ordered batches.
- Application startup is scene→controls→data→tools; cleanup is tools→controls→data→scene. Deferred cleanup is registered before awaits; cancellation and reentrant teardown must not resurrect work.
- Director LOAD/seek owns authored camera/style/layer state; Stop/replacement/teardown revoke pending generations, release handlers, and refuse late state publication. No voice-policy expansion was treated as a required feature.
- Relevant gates are native unit/runtime suites, build, import/package ownership checks, installed Scene browser controls and affected imagery browser QA. A green test helper alone is not proof of real requests, Cesium resources or native GPU rendering.

## Measured runtime behavior

### Real HTTP consumer probe — main versus exact heads

`probe.mjs` runs native fetch against a delayed loopback HTTP server. Request starts, completions and aborted sockets are recorded by the server, not inferred from source. Normalized input payloads are explicit fixtures, **not live provider observations**. Imagery calls the real `createRecentImageryLayer` through public enable/setBox/setVisibleRange/focus actions and real thumbnail source/loader; only renderer and catalog fixture are injected. Terrain calls the real `createTerrainHeights.resolveEllipsoidalGround` consumer over real request services.

| Invariant | Main | Relevant exact head |
|---|---:|---:|
| #881: shift intent while first 3 requests are delayed 500 ms: total HTTP thumbnails | 18 | 13 |
| Server-confirmed aborted thumbnail requests | 0 | 2 |
| First newly admitted request after changed intent | 495.28 ms | 14.19 ms |
| Settled retained Blob URLs | 16 | 11 |
| #889: 12 concurrent identical cold terrain consumer calls | 12 HTTP requests | 1 |
| Terrain batch elapsed, 300 ms delayed server | 310.45 ms | 302.94 ms |
| Subsequent warm consumer call | 0 HTTP requests | 0 |
| One of two terrain waiters cancelled | 2 HTTP requests | 1; live peer still receives 2400 m |
| Both terrain waiters cancelled | 2 aborted transports | 1 aborted transport |

This proves less redundant work and prompt admission, **not a general latency benchmark**. The #889 transport sharing preserves independent cancellation; lifetime abort clears the consumer cache on both versions. The combined integration reproduces 13 thumbnail requests/2 aborts and 1 terrain burst request.

#879: sequentially requesting 30 images leaves 16 URLs on both main and exact head with defaults. A configured 524,288-byte budget leaves 2 on #879 versus 16 on main (which has no byte-budget option). The probe's fixed 65,536-byte Blobs therefore retain 131,072 versus 1,048,576 actual Blob bytes. Default `memoryStats` reports 4,194,304 estimated RGBA bytes, exactly the old 16 × 256 × 256 × 4 envelope. Node does not decode these probe images: reported decoded bytes are **accounting estimates**, not measured GPU/decoded heap. Every native object URL is revoked at destroy. A transient peak of 17 URLs during admission precedes immediate eviction; the settled cap remains 16.

### Real browser ownership and scene lifecycle

`browser-probe.mjs` runs the real standalone application, installed imagery UI, real Cesium viewer/imagery collections and actual browser image decodes. It injects the declared source interface and uses loopback HTTP catalog/thumbnail/tile fixtures; other external network is aborted. Test-only CSP bypass permits the loopback fixture origin; production CSP is unchanged and not qualified by this test. Native button `.click()` dispatches installed control handlers (not a visual clickability claim). Browser is Chromium 152 with **SwiftShader/software**, not native GPU evidence.

Five enable→focus/viewport-change→disable cycles on main and the integration experiment:

- Every disable: 0 owned imagery drapes, 0 Blob URLs/bytes, 0 thumbnail DOM images; the globe returns to its one basemap layer. Primitive/data-source counts remain 1/3.
- Baseline: 78 thumbnail + 5 catalog HTTP requests; integration: 26 thumbnail + 5 catalog, including one server-confirmed cancellation. These two fixture runs mounted real Cesium imagery layers but requested no drape tiles because the selected fixture box was not in the initial camera view; do not treat them as tile-throughput measurements.
- Steady disabled listener counts: 520 main / 519 integration. Disabled DOM nodes remain in small bounded ranges (4513–4525 main; 4514–4559 integration), not an accumulating imagery-UI footprint.
- Post-GC V8 used heap grows from 53,204,084 to 54,192,844 bytes across main disabled checkpoints; integration 53,407,740 to 54,209,240. Similar short warm-up-scale drift; **not proof of a long-session heap plateau or a decoded-memory reduction**.
- Application destroy removes exported application globals, destroys the actual viewer, retains zero image URLs, and reduces listeners to 19 main / 18 integration. Remaining static DOM/listeners and V8 caches are not declared leaks from this short run.

A separate restored-main browser run imports an actual official Scene fixture through `importProjectFile`, adds a second camera shot, and executes real `seekScene(0)`, `seekScene(0.99)`, `seekScene(0.25)`. All return true with pending work=0 and correct forward/backward camera endpoints. Start→Stop settles; an immediately superseded seek returns false; running=false, pending=0, camera state remains exactly unchanged after a further 300 ms. That camera-positioned run issues **30 actual local Cesium drape-tile requests**, decodes thumbnails, and passes the same five-cycle cleanup checks plus viewer destruction. Raw results: `browser-main-scene-measurements.json`.

## Official gates and blockers

- Main `npm test`: initial ENOSPC file-watcher failure; unchanged-source rerun with `CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000` succeeds. Standard suite: 6,344 tests / 6,343 pass / 1 skip; subsequent 1-test and 13-test suites pass. Node 24.14.0. `GEV_REQUIRE_ALLOCATION_GATE=0`; this is **not** strict CI allocation-gate qualification.
- Main build and import/package boundary gates: pass.
- Main official `qa-scene-controls.mjs`: 24 checks pass, including Stop/Escape, import refusal, disposal/late-import cancellation.
- Main dedicated Director/application tests: 70/70 pass (`main-lifecycle-focused.log`).
- #879 exact-head official thumbnail tests: 9/9 pass.
- #881 exact-head official loader/layer tests: 53/53 pass after its exact dependencies are installed. First no-dependencies attempt is retained as a setup failure.
- #889 exact-head request/singleflight tests: 11/11 pass; installation consumer tests: 28/28 pass, including one shared late-floor request.
- Integrated current-main affected suites: 115/115 pass; build passes. Adopting runtime alone initially fails main's old late-floor wait; adopting #889's official increased wait and request-count assertion resolves it. Do not drop that test update.
- Integrated package boundary gate: **fails on tools-services ownership of singleflight**, as above. No adaptation silently applied.
- Main official `qa-recent-imagery.mjs`: **107 checks, 16 failures**. Mostly fixed-control geometry/rail assertions, plus an arrow-preview check and collapsed-panel/900px checks. Real disable cleanup and zero owned layers pass. This lane does not relabel the red gate green or claim an independent UI novelty; UI is sibling-owned and these are handed off as baseline gate debt. Screenshots retained under `imagery-shots/`.
- Main `test:track -- --url ... --offline-imagery`: tool terminated after 420 s; partial log ends in Target closed/detached-frame errors. No child-completion receipt exists. **Incomplete, not passing**; partial earlier checks are not whole-gate acceptance.

## Files, reproducibility, and remaining work

All evidence is under this report's directory. Main entry points: `verified-summary.json`, `verify.py`, `probe.mjs`, `probe-*.json`, `browser-probe.mjs`, `browser-*-measurements.json`, `merge-compatibility.json`, `integration-adoption.patch`, exact-source snapshots, dependency install log, and paired official `.log`/`.json` receipts. `run.py` does not propagate child exit through its wrapper: use each receipt's `exit`, not outer shell success.

`verify.py` re-reads raw outputs, asserts all five browser cleanup checkpoints per run, scene cancellation/no-late-camera-write, native URL cleanup, complete contract line count, and finally clean source worktree. No permanent source file changed, no feature branch/local commit was created, and no sibling checkout was touched. Existing owner's next actions: rebase conflict resolution, retain injected-source changes, integrate #889's current tools-services ownership, carry updated late-floor tests, then rerun strict allocation/native/browser gates. #879 should retain its honest optional-budget scope rather than be marketed as a default memory win.
