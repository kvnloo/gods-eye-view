# City builder: upstream-fit proposal

**Status:** Research and scope proposal only; no origin pull request or approval implied. The open [upstream city-planning fit question #1333](https://github.com/bilawalsidhu/gods-eye-view/issues/1333) has no substantive maintainer fit decision. Keep implementation in the fork until the direction is accepted.

## Evidence and exact source

- Upstream `main` inspected: [`10a788db78f0657e2eb5f8cdd830e6417aed354d`](https://github.com/bilawalsidhu/gods-eye-view/commit/10a788db78f0657e2eb5f8cdd830e6417aed354d).
- Existing fork [City builder draft #302](https://github.com/kvnloo/gods-eye-view/pull/302): `feature/city-builder@ee4856e8d585c328a4f6b642f9b36b6982918625`, 52 changed paths. It has a user-visible workflow, but bundles a production-sized canvas-capture/document stack and a machine-dependent image-generation route. Its description reports tests on earlier implementation heads; those are not evidence for a newly reduced upstream candidate.
- Product fit and boundaries: [upstream proposal #1333](https://github.com/bilawalsidhu/gods-eye-view/issues/1333), [fork planning objective #184](https://github.com/kvnloo/gods-eye-view/issues/184), [broader city roadmap #180](https://github.com/kvnloo/gods-eye-view/issues/180), [upstream Director](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/docs/DIRECTOR.md), [Scene document](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/docs/SCENE-DOCUMENT.md) and [UI ownership](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/docs/UI-OWNERSHIP.md).
- Upstream `AGENTS.md` was absent (404); [CONTRIBUTING.md](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/CONTRIBUTING.md) and [TESTING.md](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/TESTING.md) provide the contribution/test rules.

## Smallest reviewable **complete** feature

**“Compare two hypothetical park proposals”**: one opt-in, offline, single-browser editing and comparison flow inside the existing **AUTHORING** panel. A single synthetic neighborhood example provides the pinned, read-only baseline. This must be a *real interactive caller*, not a separate data kernel or a read-only test fixture.

1. Choose **Compare park proposals** in AUTHORING. Display a labeled **synthetic** reference with fixed example geometry and recorded source revision; do not capture or transmit the current Cesium map, imply the example is a real parcel, or add a globe layer.
2. Author and save two distinguishable **hypothetical** park options, changing the supported tree/shade/description inputs. Show the author field as **recorded and unverified**. Editing creates a parent-linked version; reopening/restoring a past version creates a new version without rewriting history.
3. Compare baseline and both options side by side in the existing Scene dialog/Vue surface. **Game** focuses one option; **Co-op** displays both **locally**—neither implies a shared room or live collaboration. Include assumptions, differences, recorded revisions and explicit **HYPOTHETICAL · NOT APPROVED** / **impacts not evaluated** captions. Synthetic markers are schematic, not surveyed locations or predictions.
4. Export and reimport a bounded, deterministic JSON project with the proposals, author strings, revisions and attribution. Invalid or authority-injecting imports fail before replacing the current project. A user can complete this flow offline after reload or fresh import, with no AI provider or external request.
5. No selected/public layers, authoritative observations, traffic controls, government approvals or existing Director projects are modified. Keep keyboard, narrow-screen, locale and reduced-motion paths operable.

This is the smallest boundary that delivers a meaningful **start → edit two options → compare → revise → export/import** journey while honoring the concrete pilot in [#1333](https://github.com/bilawalsidhu/gods-eye-view/issues/1333). A static fixture viewer alone, or a standalone validation kernel with no mounted control, is **not** sufficient. Do not claim that the upstream maintainer has agreed to the feature.

## Candidate files to carry, **pruned** from fork #302

These are source candidates for a *future* focused port, **not** claims that the existing files can be cherry-picked unchanged.

| Existing path(s) | Keep only this responsibility |
| --- | --- |
| `src/data/communityPlanning.js`, `src/data/collaborationAuthority.js` | Bounded hypothetical proposals, deterministic version/replay semantics and no authority escalation. Retain existing author provenance and their `.test.mjs` coverage. Avoid introducing a multiplayer transport. |
| `src/data/cityPlanningDocument.js`, `src/data/cityPlanningDocument.test.mjs` | Document creation, parent revisions, validated atomic import/export, replay and exact provenance. **Adapt** its current mandatory captured-image/concept fields to a synthetic reference without raster payloads; test the adapted schema, rather than pretending the current 456-line document works unmodified. |
| `src/standalone/communityPlanningFixture.js`, `src/standalone/communityPlanningFixture.test.mjs` | One reproducible synthetic block/reference and two editable starter options; no source network calls or land-use/traffic claims. |
| `src/ui/cityBuilder.js`, `src/ui/cityBuilder.test.mjs` | Real edit/save/history/restore/compare/import/export actions; remove generator and site capture concerns. Prevent stale edits and ensure failed import leaves the displayed project intact. |
| `src/ui/communityPlanningPreview.js`, `src/ui/communityPlanningPreview.test.mjs` | Present both alternatives and their baseline with explicit hypothetical/unknown labels; strip generated-image rendering. |
| `src/ui/stores/communityPlanning.js`, `src/ui/views/panels/CommunityPlanningPreview.vue`, `src/ui/views/panels/CityBuilderEditor.vue` | Existing Pinia owner → Vue view → controls contract, accessible launcher, editor and comparison. Remove provider/Imagine controls and use a single existing dialog owner. |
| `src/ui/views/LayerPanelsView.vue`, `src/standalone/tools.js` | **One opt-in AUTHORING entry** and owned lifetime/teardown. Prefer lazy loading; do not mount a second global toolbar shortcut. Adapt `src/standalone/cityPlanningServices.js` only if genuinely needed as a narrow app-composition seam—remove canvas capture, local-generator plumbing and independent storage lease. |
| `src/ui/views/cityBuilderView.test.mjs`, `src/ui/views/communityPlanningPreviewView.test.mjs`, `src/ui/cityBuilderLocales.test.mjs` | Component-mounted interaction, keyboard/focus, bounded document round-trip and locale checks for the actual mounted flow. |
| `src/i18n/locales/*.json`, `scripts/format-scope.json`, `scripts/package-boundaries.json` | Only catalogs/formatting/ownership entries required by kept UI. Avoid a bulk language rewrite unrelated to the pilot. |
| `docs/CURRENT-STATE.md`, `docs/city/CITY-BUILDER.md`, `changelog.d/<future-pr>-park-comparison.md` | Accurately document the shipped pilot, tests and limitations. Use the eventual real upstream PR number in the changelog filename. |

**Do not port the 52-path #302 diff wholesale.** First reduce the model/view ownership seams, then prove this *one integrated caller* fails on an upstream base and works at the exact proposed head. Preserve upstream Scene and Vue contributors' history; credit fork author `kvnloo` and existing code contributors in any eventual PR.

## Cut from this upstream feature

- **Machine-specific ChatGPT image bridge and provider UI:** `scripts/city-concept-server.py`, `server/standalone/city-concept.js` and `server/standalone/city-concept.test.mjs`, its `server/standalone/vite.config.js` wiring, `src/data/planningConceptGenerator.js` and its test, provider/Imagine controls, the Python executable path `/mnt/zer0models/comfyui/.venv/bin/python`, subscription credentials, and network transfer of map pixels. The bridge cannot be a portable upstream requirement. Do not present a fixture diagram as AI-generated site imagery.
- **Real-world raster capture/export:** omit current-map capture and embedding Cesium imagery (`captureCityReference` in `src/standalone/cityPlanningServices.js`) until licensed reuse, source terms and visual acceptance are established. Use a clearly synthetic reference instead.
- **New global chrome:** omit `src/ui/views/panels/GlobeActions.vue` City builder button. One contextual AUTHORING entry is enough; do not introduce a competing app mode.
- **Unnecessary machinery:** independent Web Locks/localStorage writer-lease abstraction for a synthetic pilot (use existing Scene/workspace ownership where appropriate); package-lock/dependency changes, local endpoint and endpoint-test helpers, new provider security policy. If basic local persistence is retained, it must not overwrite Director's own documents or introduce a second uncoordinated owner.
- **Ambitions without proof:** shared rooms/cursors and multiuser claims, geospatial editor or surveyed parcels, bike/road redesign implementation, measured shade/accessibility/zoning/traffic/land rights, SUMO, civic approvals, public data feeds, operational control, generalized “World Game” engine. Synthetic input does not become an evidence-backed impact assessment.
- `docs/experiments/community-park-preview.md` can remain a fork prototype note, not an upstream user manual. The 1,165-line `scripts/qa-city-builder.mjs` currently exercises real camera capture and generator paths: replace/pare it to the new synthetic journey before citing it, rather than shipping an irrelevant gate.

## Maintainer-fit evidence and anticipated objections

| Evidence, with maintainer/reviewer words | Effect on this feature |
| --- | --- |
| On closed, unmerged [#827](https://github.com/bilawalsidhu/gods-eye-view/pull/827#issuecomment-6406273863), **samehkhamis**: “without a production caller, it doesn't yet improve the app's behavior.” | Include usable AUTHORING controls and end-to-end comparison *in the same candidate* as the proposal model. |
| On closed, unmerged [#832](https://github.com/bilawalsidhu/gods-eye-view/pull/832#issuecomment-6406274745), **samehkhamis**: “alongside a UI component or production caller that actually uses it”. | No isolated policy/revision package whose only imports are tests. |
| On closed, unmerged [#888](https://github.com/bilawalsidhu/gods-eye-view/pull/888#issuecomment-6406275586), **samehkhamis**: “alongside a usable command palette or another production UI/caller”. Reviewer **quanticsoul4772** wrote [“Nothing imports the catalog yet, so there is no runtime change.”](https://github.com/bilawalsidhu/gods-eye-view/pull/888#issuecomment-6234185710) | A static launcher/fixture query or unused schema won't clear the bar. Show the full clickable workflow and mounted-component regression. |
| [Merged #616](https://github.com/bilawalsidhu/gods-eye-view/pull/616) shipped Director authoring **with** import preview, bundles and browser QA; [merged #1472](https://github.com/bilawalsidhu/gods-eye-view/pull/1472) shipped functional AUTHORING controls with screenshots, translations and keyboard checks. | Integration, finished UX, verified failure behavior, accessibility and native-browser evidence matter more than minimizing to a caller-less file count. |
| [Merged #1122](https://github.com/bilawalsidhu/gods-eye-view/pull/1122) kept bounded local-file handling, explicit attribution and original author credit; [CONTRIBUTING.md](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/CONTRIBUTING.md) says “Don't add data you don't have the right to redistribute”. | Synthetic fixtures first; no borrowed real-map imagery, unchecked datasets, request routes or ambiguous authorship/rights. |

**Fit objection remains open:** [#1333](https://github.com/bilawalsidhu/gods-eye-view/issues/1333) is an invitation to decide scope, **not maintainer authorization**. Its smallest pilot is the starting point; if maintainers do not want a planning surface, keep it fork-only. If accepted, prefer making the integrated feature on whatever current AUTHORING branch its owners are carrying over a competing PR. No upstream post or PR is warranted from this research card.

## Verification gates for the eventual focused candidate

These are *required work*, **not results**. No tests were run while writing this proposal.

1. **Base RED → focused-head GREEN** on an integrated, user-visible behavior: start synthetic project, edit/save two different plans, inspect comparison, restore an earlier version as new, export/import full author/version/revision, and reject stale/tampered authority/oversized imports without changing the original. Existing candidate files: `src/data/cityPlanningDocument.test.mjs` and `src/ui/cityBuilder.test.mjs`, adapted to the reduced schema.
2. Component regressions using `node --import=./build/registerVue.js --test src/ui/views/cityBuilderView.test.mjs src/ui/views/communityPlanningPreviewView.test.mjs` (and relevant model `node --test` files). Verify mounted AUTHORING launch, modal focus/close, keyboard, mobile, reduced-motion behavior, locale switch and that a scenario changes no live data.
3. An edited **real-app** Playwright journey: visible baseline and two compared options, preserved export/import, no external generator or implicit request, no page errors, narrow view. Run on settled/appropriate native browser renderer, capture screenshots and 15–30 second walkthrough. Existing `scripts/qa-city-builder.mjs` must be revised before it is considered evidence for the reduced pilot.
4. Supported Node 24/26, Windows compatibility where CI provides it; `npm test`, `npm run test:track`, `npm run build`, `npm run format:check`, `npm run check:boundaries`, `npm run i18n` and current-head CI. Per [CONTRIBUTING.md](https://github.com/bilawalsidhu/gods-eye-view/blob/10a788db78f0657e2eb5f8cdd830e6417aed354d/CONTRIBUTING.md), update `docs/CURRENT-STATE.md` and a numbered `changelog.d/` fragment when runtime changes.
5. Show exact-source attribution and honest limitations: recorded author is not verified, synthetic markers are not site geometry, and no accessibility, impact or approval claim is supported.

## Ready-to-copy upstream PR description — **draft only; do not post**

**Title:** `feat(authoring): compare two hypothetical park proposals offline`

### Why

GEV's AUTHORING workflow can show existing scenes, but cannot yet let someone compare two *possible* park designs while keeping those sketches distinct from real-world observations. This is a bounded, opt-in response to [the scope question #1333](https://github.com/bilawalsidhu/gods-eye-view/issues/1333), conditional on maintainer agreement that the feature belongs upstream.

### What the user can do

- Open **AUTHORING → Compare park proposals** and inspect one **synthetic, read-only** neighborhood reference.
- Edit and save **two** hypothetical park alternatives. Review their assumptions and parent-linked versions, restore an older version as a new one, and compare both beside the same baseline.
- Toggle between single-option **Game** and local side-by-side **Co-op** presentation; export and reimport the complete, validated project without losing recorded authorship, revisions or source attribution.
- See **HYPOTHETICAL · NOT APPROVED**, **impacts not evaluated** and synthetic-reference labels throughout. No existing map facts or actions change.

### Scope and boundaries

This is an offline, single-browser **user-visible workflow**, not an unused schema and not a multiplayer or geospatial planning platform. It adds no third-party data, AI generation, image upload, provider API calls, real-site capture, simulation scores, legal/municipal authority or live infrastructure controls. Existing AUTHORING/Pinia/Vue owners provide the UI lifetime; data operations fail closed and exports carry provenance. Recorded contributor/author strings are not identity verification.

### Validation

**Pending for the reduced candidate; do not reuse the broad fork draft's test totals.** Before review, attach exact-head model and mounted-component RED/GREEN evidence; a real-browser screenshot/video of the complete comparison; import rejection/round-trip and keyboard/mobile/locale checks; Node 24/26, full unit/track/format/boundaries/i18n/build gates; current-head CI. Include the actual result and link for each, with limitations.

### Documentation and credit

Update `docs/CURRENT-STATE.md`, user instructions and `changelog.d/<PR>-park-comparison.md` on the implementation branch. Preserve the existing Scene/Vue collaborators' contributions and credit the original city-planning work in fork [#302](https://github.com/kvnloo/gods-eye-view/pull/302) (kvnloo). The synthetic fixture does not assert genuine parcel or data-source rights.

**This text is a proposed description, not an upstream submission.** If maintainers decline the [#1333](https://github.com/bilawalsidhu/gods-eye-view/issues/1333) product direction, do not publish the PR.
