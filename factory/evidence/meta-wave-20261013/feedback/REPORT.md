# Feedback lane — local evidence, NOT publication-ready

## Outcome

- **#816's missing P1 real-path evidence is now independently supplied.** On pinned main `132b9e96dc1491e5db8bf949b1560f4561c925c3`, opening compact Radio on Cyber's passively collapsed Context and returning to Minimal using the keyboard leaves compact Radio over expanded Context (244 × 59.890625 CSS px intersection). Original #816 head `19372875e21266caebe54976c9be73f1d36a73b8` dismisses it. Both runs used the running real GEV app, isolated headless Chrome, actual controls, native final keyboard events, no DOM fixture/class seeding, and no page errors.
- Prepared ancestry-preserving **local** candidate `34e6516161de5bdc52f19aea746f42f53ef2b5f8` (`prep/gev-feedback-20261013`, tree `4d8ab51f81338f4779d205049c1c83108bc88e37`). Merge parent `bfa20e576b477452c37b1ba094c5f2baaa09452b` reconciles current main with the existing carrier; only CHANGELOG conflicted and both entries remain. Original production `panelChrome.js` is byte-identical to #816. Added real control regression to the **existing Radio gate**, not a replacement gate. A negative control reverting its production callback wiring fails `restored Context must dismiss compact Radio`; restored code passes.
- All six named immutable heads were exercised through their focused tests; counts and commands in `exact-head-units.json`. Complete supplied threads reconcile **13 conversation comments, zero reviews, zero inline comments**. Every comment is mapped to findings with author association, URL, exact head, evidence and one of the four requested states in `feedback-matrix.json` / `.md`. No still-open author statement is treated as proof by itself.
- **#835 remains genuinely incompatible with #837, not merely stale prose.** Its nine old focused tests pass, but a bare-ground city pointer with a named nearby place sends no crop. The same production-owner probe passes current main and preserves `client.pointer_crop`, the ringed-pointer description and retained crop frame. Current-main pointer tests also pass. Do not overwrite the current crop owner with the old reason-code method.

## Actual #816 reproduction and artifacts

1. Open Display and select Minimal; expand Context; close/reopen Display to make Display the preferred rail owner.
2. Select Cyber; wait until Context is `collapsed cyber-accordion-collapsed` through the app's own layout.
3. Click the compact Radio header control. Do **not** synthesize its disclosure classes.
4. Shift-Tab through normal focus order back to the HUD layout select; ArrowUp selects Minimal; Tab out. Outside pointerdown correctly closes Radio, so a mouse-only theme change masks this missing restore cleanup.
5. Wait for Context to expand; capture owner/mini rectangles and full-page image.

Before: `main-stable-after-keyboard-theme-exit.png` + `main-stable-radio-repro.json`.
After original exact #816: `pr816-after-keyboard-theme-exit.png` + `pr816-radio-repro.json`.
Current candidate gate: `radio-green/ownership-restored.png` + `radio-green/ownership.json`.
Final committed-head repeat: `final-negative.log` fails the same assertion at `34e6516…` plus the single callback mutation (`final-negative.patch`, `final-negative-hashes.txt`); `final-green.log` passes after restoration. `git diff --exit-code` and final clean status verify mutation restoration. Final full-app screenshots/events are under `final-negative/` and `final-green/`.
`radio-repro.mjs` retains the full exploratory reproduction; `run-ownership.mjs` invokes precisely the helper integrated into `scripts/qa-radio.mjs`.

The original tactical starting-state explanation was **not** proven reachable (exclusive Tactical layout can hide collapsed launchers). The new real Cyber path replaces that explanation. The source-level tactical test remains an explicitly isolated scheduler control; its misleading reachability comment was corrected.

## Requirements and gates

The pinned CONTRIBUTING baseline is build + unit suite + live tracking + affected browser gate, all green, plus format and package boundaries. Runtime fixes require CHANGELOG and CURRENT-STATE, and new adopted tests require formatter registration. Actual CI includes Node 24/26, Windows onboarding and Street Level/portable-panel browser jobs; the contribution guide's claim of no browser CI is stale. Parent owns contributor/Linear/publication decisions. `action_required`/no jobs is admission, not a failing test.

| Exact revision | Command / result |
|---|---|
| main `132b9e9…` | `npm test`: 6,343 passed, 0 failed, 1 skipped; Node26 runner additionally excludes two Node24-calibrated allocation microbenchmarks |
| main `132b9e9…` | `npm run build`: exit 0 |
| main `132b9e9…` | `npm run test:track -- --url http://127.0.0.1:4181`: 102 passed, 7 failed, 0 skipped |
| main `132b9e9…` | `node scripts/qa-radio.mjs --url http://127.0.0.1:4181`: 103 passed, 3 failed |
| candidate `34e6516…` | `npm test`: 6,345 passed, 0 failed, 1 skipped; same two allocation exclusions |
| candidate `34e6516…` | build, format:check, check:boundaries: all exit 0; clean tracked worktree before/after |
| candidate `34e6516…` | full Radio gate: 106 passed, 1 failed; new real-restoration assertion passes. Remaining console failure is `/api/google/tiles-token` 404, also present in baseline |
| candidate `34e6516…` | live tracking: **109 passed, 0 failed, 0 skipped**, exit 0 |
| #834 `3a3a1ed…` | focused imported share owner: 3 passed; **full unit suite exit 1** (existing source-contract assertion), **format exit 1** (new notice test unformatted); build and boundaries exit 0 |
| #835 `cacbbc9…` | existing reason-code + owner tests: 9 passed; supplemental compatibility probe: expected RED, exit 1 |
| #917 `76b003b…` | Recent Imagery component tests: 15 passed, **not** full browser gate |
| #918 `a24b1cd…` | panel rail tests: 35 passed, including CSS-hidden exclusivity; not full browser proof |
| #851 `6cfd879…` | focused projection/crop/owners: 20 passed; additional actual Realtime input/card/projection suite: 171 passed |
| bundle-restored candidate | 40 focused Radio/rail tests passed; original carrier and pinned main ancestry verified |

Raw logs retain failures. Baseline tracking included floor assertions plus outdated Vite dependency HTTP 504s; Radio had cluster opacity and console/504 failures. These are **not** silently waived, and cross-run improvement is not attributed to the narrow Radio patch. Candidate full baseline and admission prevent readiness even though its ownership defect is closed independently. No paid voice, microphone/provider session, authentication or key changes were performed.

## #835 / #837 boundary

#837, authored by Bilawal Sidhu, merged as `208814a094104c9a3d6f1af75635d2d5be5fbfbc`. Current `src/voice/realtimeViewport.js` (with later voice-review fixes by manjunath22466, building on Sameh Khamis's owner separation) owns pointer crops, one retained image, camera/age validity, fresh-frame recovery, sequence cancellation and ring geometry. `viewport-compat.mjs` exercises its real dispatch method with declared capture/send stubs; it is a protocol boundary test, **not live voice transmission**. `pr835-compat-red.log`, `main-compat-green.log`, `main-pointer-tests.log` preserve results. `pointer-crop.jpg/json` is a real app-owner capture showing the cyan ring and 512px crop; the initial keyless frame is white, so this does not establish meaningful terrain imagery or live model interpretation. The old head also has a real merge conflict in this owner (`pr835-merge-tree.log`). Reapply diagnostics around both current paths and verify decisions/outcomes without discarding ring/camera/retained-frame semantics. No #835 production rewrite is claimed here.

## Remaining holds

- #834: CHANGELOG-only current-main conflict independently confirmed. **Full exact-head execution exposed two real open blockers despite its three focused tests passing:** `src/loadingFeedback.test.mjs:95` still requires the startup-cover scheduler inline in the original handler, and `format:check` rejects `src/ui/shareInvalidLayerNotice.test.mjs`. Build/boundaries pass. Preserve the requested shared scheduler while reconciling source-contract/behavioral coverage; do not declare the author's old “fixed” reply closure or simply weaken the assertion. Share browser/current-base qualification remains.
- #917: proof workflow removed and strict defaults retained (2s/12 samples, explicit slow flag 4s/8). Full Recent Imagery gate remains unqualified. #1061 remains a separate open launcher carrier at `57a05f81579f800771dc8116dc566205286b1659`; do not duplicate it.
- #918: focused CSS-hidden fix tests green, dedicated full-app/browser and full baseline still required.
- #851: narrow #837 compatibility verified, but projection has no production consumers; do not advertise a changed live HUD. No live voice session tested.
- Exact hosted Actions admission, exact Linear origin-action authorization and independent review of the added gate remain parent-owned. No GitHub/Linear writes, pushes, comments, workflow approvals/reruns or merges were made.

## Delivery and provenance

Durable home: `.//feedback`.
Candidate checkout: `<operator-worktrees>/gev-meta-wave/feedback`.
`radio-candidate.bundle` is self-contained, verified, restored into an isolated scratch clone and retested; SHA-256 `189b6af704fa226f26d4203ba3d8ec19b24c06e9be0c75ff208fbbbdc7d3c394`.
`radio-candidate.patch` is the current-main comparison, not a substitute for ancestry.

Credits: raysung-2026 reported #804; Said / asturksever requested reachable-path evidence and rail-seam coverage; kvnloo authored the existing fix. Hermes supplied independent real-app reproduction, negative controls, local ancestry reconciliation and gate integration, with AI assistance disclosed in local commits. No signatures or approvals were fabricated.

Environment: Node 26.5.0 through existing fnm, installed lockfiles, isolated Chrome 152.0.7977.75, headless SwiftShader request, private profile and short active-profile scratch TMPDIR, core dumps disabled. z0 search was unavailable; bounded explicit local discovery was used. Jev action selection returned invalid-request and failed open; no private data/credentials were submitted. Initial Puppeteer import path assumed an old `lib/esm` layout; corrected to package resolution and reran successfully. These setup failures are not behavioral RED evidence.
