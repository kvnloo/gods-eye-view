# Workflow / conflict-reduction lane — execution report

## Outcome

**Independent qualification delivered; no remote writes, competing implementation, or published-token changes.**

- **#787 normal release path verified.** The previously reported interrupted-release duplication still reproduces on the current author head. It is not an author fix and not a novel finding. Preserve daikaginza's ownership and suppress another diagnostic comment.
- **#957 source review qualified.** The actual two-file docs diff contains the requested contributor evidence fields and correct categories. No correctness blocker found in that bounded review; optional wording only, unsent.
- **Published token rules qualified through real helpers and Git fixtures:** 72 tests pass on each of Node 24.14.0 and 26.5.0; negative control fails four tests and restores to 72 passing. The full browser gate remains **incomplete** after the same legacy-page navigation timeout on two Chrome versions.
- **Measured fragment benefit, full pinned 27-PR sample:** 14 PRs conflict; 11 have a CHANGELOG conflict. Lossless changelog-only migrations remove all 11 path conflicts, leaving **5 PRs completely conflict-free**: #943, #889, #874, #834, #816. No CURRENT-STATE/code edits or speculative time savings.

## Immutable identities and ownership

| Surface | Exact revision | Disposition |
|---|---|---|
| Latest upstream main | `132b9e96dc1491e5db8bf949b1560f4561c925c3` | Opening and closing remote SHA agree |
| #787, daikaginza | `1d409adf91f666a7b32e7af6640ffeb1d89d1ee7` | Original author head tested unchanged |
| #787 merge-base | `e7707d9a0f34d9fbffc300023c319f95caa5be30` | Author branch ancestry, not current main |
| #957, asturksever | `84fb493258d48a5b179b41e9319b954577859b88` | Exact docs head inspected; clean current-main composition |
| #957 recorded base | `e685449a52550775a5279cef1b9090ef24d507a2` | Kept separate from latest main |

The assembler was last changed by `114b0eeaba1d3cb9cb142e4521c79b396d3e439d`; its unchanged blob is `8f3e854eff9d11c94c4c5e0c232c4ca0b36f2379`. There is no later transaction fix on #787. Current-main composition conflicts in `docs/MAINTAINER_WORKFLOW.md` and `scripts/format-scope.json`. Neither was edited here.

The assigned checkout did not initially exist; an owned unpublished `prep/gev-workflow-20261013` worktree was created from the author head. It remains at that head with no source modifications. A separate disposable main checkout qualified the current token rules; its tracked tree is clean after the mutation control. No implementation/test-only candidate commits were made. Counterfactual analysis commits are explicitly non-delivery objects, enumerated in `fragment-counterfactual.json`.

## #781 / #787 thread reconciliation

Complete fresh conversation comments, reviews and inline comments were saved and checked again at closing; the conversations did not change. #781 has 3 comments; #787 has 3 comments, one historical approval, no inline comments; #957 has no comments/reviews/inline comments.

- daikaginza owns the measurement, fragment design and implementation. #781's strategy proceeds through #787; do not reopen a competing strategy discussion.
- kvnloo's release-integrity finding is already present at [5861942204](https://github.com/bilawalsidhu/gods-eye-view/pull/787#issuecomment-5861942204) and [5862817863](https://github.com/bilawalsidhu/gods-eye-view/pull/787#issuecomment-5862817863). **Disposition: open, already reported.** The later comment explicitly calls it non-blocking hardening; this lane does not invent a maintainer changes-requested verdict.
- The later author reply is a census, not a fix. Its historical denominator must not be mixed with this factory's current 27-PR cohort.
- The approval is on `d29ff40d04a1ce7de8872488159e38e39f570339`, not a new current-head review.
- Existing original design/consumer discussion is superseded by the implementation carrier, not an unowned follow-up opportunity. All HITL and publication holds remain.

## Real release interruption receipts

`qualify-release.py` exports the exact official assembler and original package script to disposable real Git repositories. Each has a committed published baseline, a contributor branch containing two differently credited multiline fragments, and a release branch. All normal Git/file transitions are real. A child-only `--import` hook intercepts only `writeFile`/`rm`, with `syncBuiltinESMExports`; production source is unchanged.

Actual command in every fixture: `fnm exec --using=<version> npm run changelog` (and `changelog:check`). Retry runs without the fault hook.

| Scenario | Node 24.14.0 | Node 26.5.0 | Observed final copies |
|---|---|---|---|
| Healthy write, then repeat | PASS | PASS | Each entry once |
| Throw before changelog write, retry | PASS | PASS | Each entry once |
| SIGKILL after changelog write, retry | **RED** | **RED** | Both entries twice |
| Throw on second fragment removal, retry | **RED** | **RED** | First once, surviving second twice |
| SIGKILL after first removal, retry | **RED** | **RED** | First once, surviving second twice |
| Invalid duplicate-number batch | PASS | PASS | No output/input changes |

All six scenarios on each runtime preserve unrelated authored bytes, README, script/package bytes, the preexisting release note and HEAD/ref identity. `--check` is read-only in all cases. The fault command's nonzero exit is expected; the RED assertion is duplicate content after an ordinary retry. These are controlled interruption reproductions, not a measured natural crash rate. No GREEN crash-safety implementation is claimed because the mechanism remains author-owned.

Receipts: `release-results-node24.14.0.json`, `release-results-node26.5.0.json`, both `release-node*.log`, `release-summary.json`, original source under `source-787/`, and `release-fixtures.tar.gz` (12 real fixture repositories). Archive SHA-256: `f2e41685a384a0b56285bf31bc38df56565daffa56ce153f667502f266bb61e7`.

## #787 official gates actually run

Linux x86_64; Node 24.14.0; own locked dependency install, Puppeteer download suppressed without changing allowScripts policy.

| Command | Result |
|---|---|
| `node --test src/tooling/changelogFragments.test.mjs` | 13 pass, 0 fail |
| `npm run format:check` | exit 0 |
| `npm run check:boundaries` | exit 0 |
| `npm run build` | exit 0; normal build warnings retained in log |
| `GEV_REQUIRE_ALLOCATION_GATE=1 npm test` | 5,397 tests: 5,396 pass, 1 skip, 0 fail; includes 1 + 13 allocation probes |
| `npm run test:track -- --url http://127.0.0.1:4183 --offline-imagery` | **109 pass, 0 fail, 0 skip**, real headless Chromium 153.0.8010.52, fixture imagery |
| `node scripts/qa-l9-matrix.mjs --url http://127.0.0.1:4183 --only A7 ...` | 1 selected, 1 PASS; public-file/CHANGELOG existence coupling |

The first `--only A` invocation used the default port 4173 and exited 2 before running checks. The corrected A7 invocation is the relevant receipt; **full L9 group A is not claimed**. The tracking child exited 0 even though the initial wrapper's immediate post-cleanup bind raced socket release; `ss` confirmed no listener/owned process remained. The wrapper now waits boundedly for release and propagates child failures; a deliberate missing-browser control returned 1 and left port 4183 free.

Fresh hosted `gh pr checks`, run metadata and jobs show three successful jobs each for #787 and #957 (Node 24.14.0, Node 26.x, Windows onboarding). These are their existing exact-head runs, not new CI or current-main integration validation. Green checks do not clear #787's merge conflicts.

## #957 exact-head review

The actual diff changes only `.github/pull_request_template.md` and `CONTRIBUTING.md`. It asks for globe plus card/panel screenshots, a recording, proposed category, provider/endpoint, licence/terms link, in-app attribution, key requirement and runtime-vs-bundled delivery; it references DATA_SOURCES, data credits and share-token allocation.

Movement, Cameras, Infrastructure, Events, Weather and Utilities match `PANEL_GROUPS` on both the author head and current main. The evidence requirements are conditional on adding a layer. This docs-only PR does not introduce a dataset/license or need its own new-layer screenshots. This is review guidance, **not an automated evidence/licence enforcement gate**. GitHub's quoted video-size limit was not independently verified.

The optional unsent suggestion is to show `npm run layer-token:next -- <layer-id>` and link existing merge-time/check instructions. The `CHANGELOG.md` checkbox is correct under current main; it would need follow-up only if #787's separate fragment convention is adopted. Do not duplicate #1074's CI-guide work. Source qualification, not a separately run #957 full local application suite: `template-957-source-qualification.json`.

## Current published-token qualification

At exact current main, `layer-token:check` reports **29 published, 0 new** both against the full SHA and pinned `origin/main`. The helper prints `workflow-provisional-probe: 3` without editing files. Requesting `street-level` correctly refuses because it already owns published `0`. `00` remains **unpublished**, not an assignment made by this lane.

- `node --test src/data/layerState.test.mjs src/data/layerStateTokenLedger.test.mjs`: **72/72** on Node 24.14.0 and **72/72** on Node 26.5.0.
- Existing real-Git tests cover a competing PR publishing `3`, stale/duplicate provisional rejection, removing only the unpublished candidate, helper reporting `4`, preservation of the published row, retired reservations and digit/base-36 boundaries.
- Disabling only published-assignment equality in the disposable main copy makes four tests fail. Restoring it returns **72/72**, and `git diff --exit-code` confirms exact source restoration. Published registry and ledger files were not changed.
- Official `qa-layer-token-twochar.mjs` reached five checkpoints on each of two unchanged-source runs: isolated digit exhaustion, user enable/share `00`, cold-recipient restore without local preference writes, reload, and explicit OFF. Both runs then exited 1 on a **60-second navigation timeout at line 285** opening the legacy `f` page. Browsers: system Chromium 153.0.8010.52, then cached Chrome for Testing 152.0.7977.75.

**Full token-browser qualification is BLOCKED/INCOMPLETE.** Legacy/mixed/malformed/repeated-field and all-session final checks did not complete. Cause is not established; do not label it a new production regression or borrow the unit result as browser proof. No browser assertions were weakened or production injection committed. Raw failures and retry receipts are retained.

## Conflict reduction: measured, bounded, lossless

`measure-fragment-conflicts.py` consumes and verifies the portfolio lane's complete 27 unique pinned rows at main `132b9e96dc1491e5db8bf949b1560f4561c925c3`.

For each of the 11 CHANGELOG-conflicting PRs it confirms a single additive hunk with no removed lines, restores only CHANGELOG to that PR's merge-base version via a temporary Git index, and puts the exact introduced prose/credit into a distinct fragment. `git merge-tree --write-tree` is rerun. It asserts that the only changed paths are CHANGELOG and the new fragment, and that the remaining conflicts equal the original set minus CHANGELOG.

Result: **11 avoidable path-conflict incidents; 5 whole-PR conflicts removed**, within this **27-PR sample**. The other six still have their original unrelated conflicts. This does not automatically migrate published PR branches, clear feedback/CI, measure maintenance minutes, or duplicate the portfolio lane's broader two-document counterfactual. Author/integrator adoption is still required.

## Delivery, limitations and next actions

- Durable machine ledger: `findings.json`; complete raw logs, snapshots, probes and analysis results in this directory. Unsent disposition-specific feedback: `DRAFT-FEEDBACK.md`.
- No implementation commits, pushes, comments, reviews, branch rewrites, default merges, approvals or token allocations. The analysis created only local non-delivery Git objects and an unpublished preparation ref pointing at the unchanged author head.
- Credits: daikaginza for fragment measurement/design/implementation; kvnloo for the earlier consumer/design and interruption findings; asturksever for the template. Bilawal Sidhu and Sameh Khamis retain maintainer decisions. This lane is AI-assisted independent qualification by Hermes, not original implementation authorship.
- **Next:** retain #787 owner and known non-blocking hardening disposition; let owner/integrator address its current merge conflicts rather than producing a rival PR. Keep the quantitative 27-PR evidence downstream. Investigate the token browser's legacy-page navigation failure before claiming full browser readiness. Parent alone owns any later authorized publication.
