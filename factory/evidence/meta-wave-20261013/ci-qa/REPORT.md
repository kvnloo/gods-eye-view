# CI/QA reliability — verified local results; publication held

## Outcomes

- **27 exact current heads audited** at 2026-10-14T00:50:46.099987+00:00: 26 distinct latest workflow runs, all attempt 1, all `action_required`, **zero jobs and zero executed-test verdicts**. #845 has no current-head run. No head drift from opening pins. No approvals, reruns, pushes, comments or other remote writes occurred.
- Main remains `132b9e96dc1491e5db8bf949b1560f4561c925c3`. Both supported runtimes pass doctor, adopted formatting, package boundaries, production build and `npm test`.
- Independently reproduced quanticsoul4772's #1062 stale-anchor defects RED on the actual parent and GREEN on the original owner head. Existing fixes were not copied/reimplemented.
- Real application tracking: **109 passed, 0 failed, 0 skipped**. Main FIRMS fixture gate: **7 passed, 1 failed**; targeted diagnosis identified a post-click sampling race. Minimal downstream gate repair: **8 passed, 0 failed**, with **3/3 helper controls** on Node24/26 and full suites green.
- Built-preview Street Level strict gate: **29 ok, 3 documented Google-provider skips**; portable-panel gate passes on dev and built preview. Strict panel policy remained enabled; motion-explained press retries were logged, not hidden.

## Environment and exact test cohorts

Linux x86_64, kernel 7.2.9-1-cachyos, Node **24.14.0** and **26.5.0**, Chrome for Testing **152.0.7977.75**, headless SwiftShader, port **4182**. Private profiles and short scratch TMPDIR; core dumps disabled. Main dependency reuse required byte-identical `package.json` and `package-lock.json`; `environment.json` retains hashes and runtime versions. Owner checkouts have their own dependency installation where manifest equality failed. No native Windows host was available.

| Tree | Node | Ordinary tests | Allocation tests |
|---|---|---|---|
| main `132b9e96dc1491e5db8bf949b1560f4561c925c3` | 24.14.0 | 6343 pass, 1 Windows-only skip, 0 fail | both files executed: 1 + 13 pass |
| same main | 26.5.0 | 6343 pass, 1 Windows-only skip, 0 fail | official two-file Node26 skip |
| main + `candidate.patch` | 24.14.0 | 6346 pass, 1 Windows-only skip, 0 fail | both files executed: 1 + 13 pass |
| same candidate patch | 26.5.0 | 6346 pass, 1 Windows-only skip, 0 fail | official two-file Node26 skip |

Commands on both baseline runtimes (`VERSION` is each exact version above):

```sh
fnm exec --using=VERSION npm run doctor -- --json
fnm exec --using=VERSION npm run format:check
fnm exec --using=VERSION npm run check:boundaries
fnm exec --using=VERSION npm run build
fnm exec --using=VERSION npm test
```

Node24 uses `GEV_REQUIRE_ALLOCATION_GATE=1`; Node26 uses `0`. The official runner owns allocation selection; no tests were manually removed. Candidate full `npm test` was rerun on both versions; source hashes were unchanged throughout. Candidate format/boundaries and dummy-token build also pass. `baseline-results.json`, `candidate-test-results.json`, `RESULTS.json` and raw `logs/*` retain command exits and every summary block.

## Existing-owner qualification and adoption

### #1062 — quanticsoul4772: stale mutation anchors

- Original parent: `591f299d11f38a612629a274463196d57ae3862e`.
- Original owner head: `123bf55f39a7dc12cad6215b362da0acc91c6c23`.
- `fnm exec --using=24.14.0 node scripts/qa-floorhold-mutations.mjs`: parent exit 1 (20 caught, 2 stale anchors); owner exit 0 (**22/22** caught).
- `fnm exec --using=24.14.0 node scripts/qa-flyroute-mutations.mjs`: parent exit 1 (11 caught, 8 stale); owner exit 0 (**19/19** caught).
- `fnm exec --using=24.14.0 node scripts/qa-firstrun-mutations.mjs`: parent exit 1 (40 caught, 27 stale); owner exit 0 (**67/67** caught).
- Every mutation gate restored its source; clean status recorded. Original unmutated affected tests also pass. `pr1062-results.json` and six raw RED/GREEN logs preserve evidence.
- This owner's own current hosted run has four successful jobs. It is **not** one of the factory-owned 27 and is not counted in their zero-job matrix.

### #1064 — quanticsoul4772: early-exit cleanup

Owner head `1fb09561ee378c96bebdbda2e74615f6d1983bb1` compared with exact current main. `qualify_1064.py` executes the original four gate entrypoints (`qa-firms`, `qa-traffic`, `qa-traffic-jamviz-ab`, `qa-traffic-preset-ab`) on Node24/26 against bounded loopback no-key, HTTP404 and unreachable controls: **48 executions**. All return 2; 24 main runs explicitly exit, 24 owner runs naturally drain through `beforeExit(2)`. The observer delegates original exit behavior rather than replacing it. No provider key/network acceptance is asserted. **This is Linux exit-lifecycle evidence, not native Windows/libuv crash reproduction.** See `pr1064-results.json`, `exit-observer.mjs`, raw logs and exact commands in the driver.

### #997 — quanticsoul4772: installed-executable stub

Owner head `6995de07b9b48a34f839db4e51a7758ca472afbf`. The unchanged exact test and sole production import were exported and executed with `fnm exec --using=VERSION node --test src/codexOauthRealtime.test.mjs` for main and owner on both supported Linux runtimes; all four executions pass. Exact-predicate controls accept POSIX paths on both versions; the old suffix predicate rejects Windows separators while the owner's equality predicate accepts them. **These are path semantics, not native Windows proof.** The current Windows onboarding job does not select this test file, so green onboarding does not validate this fix. See `pr997-results.json` and `997-exact-files/`.

### #1074 — aitradesniper-blip: browser CI documentation

Owner head `3088f4df0d2b140642a6bae68afbe222749ce694`. Static assertions compare its guide with actual current workflow/scripts: Street Level fixtures and portable-panel gates run against a production preview; tracking remains local. The real preview run here independently exercises the documented workflow. Existing kvnloo review already addresses the same documentation; no duplicate feedback was posted.

All nine touched owner-file blobs on current main are still **identical to their respective merge-base blobs**, not the repaired owner blobs: none of these four changes has been adopted. `owner-base-comparison.json` makes that stronger than a mere nonidentical-head comparison. Current owner CI for #1064/#997/#1074 remains `action_required` with zero jobs. Original authorship remains intact.

## Browser commands and limitations

```sh
fnm exec --using=24.14.0 npm run test:track -- --url http://127.0.0.1:4182 --offline-imagery
fnm exec --using=24.14.0 node scripts/qa-firms.mjs --fixtures --url http://127.0.0.1:4182
fnm exec --using=24.14.0 npm run qa:panel-resize -- --url http://127.0.0.1:4182
MAPILLARY_CLIENT_TOKEN='MLY|0|qa-fixture' fnm exec --using=24.14.0 npm run build
# Owned strict-port Vite preview, then:
fnm exec --using=24.14.0 npm run qa:street-level:fixtures -- --strict --url http://127.0.0.1:4182
fnm exec --using=24.14.0 npm run qa:panel-resize -- --url http://127.0.0.1:4182
```

Tracking uses the real dev application, bundled offline imagery and the gate's declared controls; it is not live-provider data acceptance. FIRMS uses disclosed synthetic requests, not a paid NASA key. All Mapillary requests were fixture-answered; Google 3D FOLLOW, Google 3D earth-placement branch and Google Street View provider behavior are documented skips. Strict panel policy permits demonstrably motion-explained misses; warnings are preserved. No native GPU, native Windows or live paid-provider claim is made. `run_preview.py` owns readiness, strict port, deadline and server cleanup. Its first wrapper execution exited 1 only at the final non-reuse bind probe, after all three child commands exited 0. A fresh `ss` read showed no listener, and the corrected SO_REUSEADDR bind passed; `cleanup-verification.json` preserves this distinction. The probe was fixed and exercised independently; the full browser suite was not rerun for that probe-only correction. Initial Chrome/socket-path setup failures and the failed diagnostic import were retained; corrected runs are separately named.

## Narrow downstream repair (not an owner replacement)

`candidate.patch` touches only:

- `scripts/qa-firms.mjs`: allow the existing bounded action-count waiter to observe `selectedCount`, and use it instead of a fixed 250 ms post-click sleep.
- `src/qaFirmsActions.test.mjs`: execute the actual source helper with a deterministic clock/snapshot tape; cover delayed selected publication, bounded permanent absence and preserved aggregate-count behavior.
- `scripts/format-scope.json`: adopt only the new test. No broad formatting, app/runtime changes, owner early-exit edits, docs or changelog edits.

Natural baseline browser RED retained all correct selection, tracking-release, generation and flight values, but sampled `selectedActions=0`. Diagnostic samples showed selection absent at 250 ms and present at 500 ms. The candidate retains every original assertion and passes all eight browser checks. Helper controls first failed **2/3** on baseline and then passed **3/3**; these helper controls alone do not lock the browser call site, whose separate real-app receipt is retained. Diagnostic extra waits are not the shipping fix.

Reviewed relevant overlap carriers #1064/#865/#1061/#965/#1044/#1043/#1078; no duplicate selected-action synchronization change was identified there. This local finding is separate from #1064's owned early-exit mechanism. Publication still requires parent's final ownership/independent-review checks; no claim of exhaustive 305-PR changed-hunk novelty is made.

Patch SHA-256: `5802a4956d3f76cd75d81f8f4401ba88e6c5de7336c0509acec7b2d06d91047f`. Base and per-file hashes: `candidate-provenance.json`. Reverse-apply check verifies the patch describes the retained worktree. No commit was created: Git author identity is unset and was not invented or globally configured. The patch, exact candidate files and owned worktree are retained for parent commit/review. AI-assisted local diagnosis and implementation are disclosed here; no attribution to the existing PR authors is claimed for this separate repair.

## CI source, dedupe and held approval scope

`workflow-sources.json` binds `.github/workflows/ci.yml` to all 27 exact heads: **two unique blobs**, one present at 6 heads and one at 21. The current-main blob includes the browser job; the older blob does not. Workflow source obligations are not asserted to be branch-protection requirements.

`audit_ci.py` reconciles paginated run totals and latest-attempt job totals, keys runs by ID, and deduplicates latest runs by exact head plus workflow ID/path. All 26 current runs are attempt 1; there are no duplicate latest approvals or executed jobs in this cohort. `held-admission-queue.json` is a non-authorizing proposal only. Approval authority and mandatory Linear authorization remain unresolved; no action was taken.

| PR | Exact current head | Latest run / attempt | Classification | Jobs |
|---|---|---|---|---:|
| #789 | `4ab530b8a83c6f56b34612c1ea5c9bc07c34e3ea` | 36373939827 / 1 | admission_action_required_zero_jobs | 0 |
| #806 | `28c7f46deed42e24cee472fa0560f41dd3eea9c7` | 36466705831 / 1 | admission_action_required_zero_jobs | 0 |
| #808 | `2863bd89511ca08936d4da905a3d56a63b333168` | 36531174186 / 1 | admission_action_required_zero_jobs | 0 |
| #811 | `7a7df9e11188cb837c225e0d6d3b297ca14573e8` | 36494168894 / 1 | admission_action_required_zero_jobs | 0 |
| #816 | `19372875e21266caebe54976c9be73f1d36a73b8` | 38272297462 / 1 | admission_action_required_zero_jobs | 0 |
| #818 | `f8d44552fb7d6ae7daf1990148ee1f219e8f628f` | 36499319495 / 1 | admission_action_required_zero_jobs | 0 |
| #827 | `a874e850c630945c5cd005b077662f689782e149` | 36505657719 / 1 | admission_action_required_zero_jobs | 0 |
| #832 | `07ac22af158e39f597e3f34551cd943cc59a2f72` | 36509192312 / 1 | admission_action_required_zero_jobs | 0 |
| #833 | `bd3829a54d53a65e4263b2e73b71a8bbc624b6ca` | 36509203358 / 1 | admission_action_required_zero_jobs | 0 |
| #834 | `3a3a1ed1c04a5873f8b7b9244e278ba08042ce8e` | 38268493268 / 1 | admission_action_required_zero_jobs | 0 |
| #835 | `cacbbc972bf8ada8314a2a62b7cdae1abefa6c0c` | 36510827671 / 1 | admission_action_required_zero_jobs | 0 |
| #836 | `47e47653704239a49c9419ee19daa835d2ddc469` | 36511058716 / 1 | admission_action_required_zero_jobs | 0 |
| #844 | `98e39bc16153f62f5cb1f17526a18be4c04009a3` | 36520461895 / 1 | admission_action_required_zero_jobs | 0 |
| #845 | `c232419cc401756671244cea263f64f9edaedbab` | none | no current-head run | 0 |
| #847 | `28f3243090fe2aa766d9df2f096e095811f04ac0` | 36525734015 / 1 | admission_action_required_zero_jobs | 0 |
| #848 | `e9236f7a58c5b3f1b076a67aff8c849867bb08a0` | 36525746537 / 1 | admission_action_required_zero_jobs | 0 |
| #851 | `6cfd879bd87798790ff499846840960abd70c796` | 37885970281 / 1 | admission_action_required_zero_jobs | 0 |
| #874 | `424bd3b66b3463dacb2384f619dadef7eb558029` | 36810295492 / 1 | admission_action_required_zero_jobs | 0 |
| #879 | `f96cd157f8f7f0c1b8dbf3440e638ba4c78820d3` | 36830437866 / 1 | admission_action_required_zero_jobs | 0 |
| #880 | `2b7f832f456c933811c8dc0faa75caf111816718` | 36830441586 / 1 | admission_action_required_zero_jobs | 0 |
| #881 | `85227cca9dc0fa74055c5f4e9490fea932f86875` | 36830444874 / 1 | admission_action_required_zero_jobs | 0 |
| #882 | `264764676538b67ce67c9e5d199637e107dacf59` | 36830448434 / 1 | admission_action_required_zero_jobs | 0 |
| #888 | `c141a805147d450f3e599f391fa8ec1469e62ee8` | 36932010522 / 1 | admission_action_required_zero_jobs | 0 |
| #889 | `62159fd3546f41a54f7518ddf75c4c9170aacb86` | 36932023886 / 1 | admission_action_required_zero_jobs | 0 |
| #917 | `76b003bc959bca612e9749b9341f4baa32c2f075` | 38284767154 / 1 | admission_action_required_zero_jobs | 0 |
| #918 | `a24b1cde3dcd13d29e5beb84111f61093f12b05e` | 38284748813 / 1 | admission_action_required_zero_jobs | 0 |
| #943 | `f06755cdbfb80b877740af0916069643c3b13aa0` | 38053736392 / 1 | admission_action_required_zero_jobs | 0 |

## Top remaining blockers / next actions

1. **Admission/authorization:** parent must obtain the exact action-scoped authorization and applicable upstream Actions approval rights before acting on the 26 held runs. #845 needs an explained missing-run path, not an invented failure verdict.
2. **Native Windows evidence:** qualify #997's actual test and #1064's early exits on native Windows; the current focused onboarding selection does not supply that coverage. Do not relabel Linux fixtures as completion.
3. **Owner adoption and review:** use the original #1062/#1064/#997/#1074 carriers and credit. Prioritize #1062's independently demonstrated RED/GREEN and #1074's source-verified docs. Independently review the small separate FIRMS patch before committing/publishing; Git identity and publication authorization remain unconfigured/held.

Durable evidence home: `.//ci-qa`. Machine index: `RESULTS.json`; complete raw current payloads: `closing/remote/`; historical opening raw reads remain in `remote/`. Screenshots/artifacts: `browser-evidence/`, plus diagnostic samples under `firms-diagnostic/`. Reproducible drivers, owner receipts, patch and source hashes remain alongside this report.
