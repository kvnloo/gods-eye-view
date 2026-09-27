# God's Eye View — controlled contribution wave

Date: 2026-09-27  
Upstream: `bilawalsidhu/gods-eye-view`  
Frozen baseline: `b210ab0fe4d71c7faa0268134e0aa5f3c53fc7fe`  
Protocol: `oss-factory:v2`  
Status: `ANALYZE -> PILOT -> EXPAND`

This is a downstream control plane. Workers must not post upstream from this branch.

## Objective

Maximize durable upstream improvement per maintainer minute, not PR/comment count.

Use the repository's own acceptance order:

1. usefulness / scope;
2. correctness + regression proof;
3. security / supply chain;
4. restricted runtime + feature-gate evidence;
5. attribution and final-candidate verification.

The experiment is successful only when it changes a maintainer decision, removes review work, produces a causal regression, salvages an existing contribution, or lands a focused patch. Replies and comment volume are not success metrics.

## Maintainer / contributor dialect

### Maintainers

**Sameh Khamis**
- Merge comments are usually very short.
- Repeated positive phrases: clean, carefully reasoned, thoughtful, spot-on regression test, mutation-tested, calibration-aware.
- Frequently lands a small maintainer follow-up rather than asking the contributor to redesign a sound PR.
- Prefers the smaller duplicate when two fixes solve the same bug.

**Bilawal Sidhu**
- Will accept large coherent product work, but often integrates community work into a maintainer-owned candidate while preserving contributor authorship.
- Treats provider terms, public-service load, local-first security, and truthful user-facing claims as product requirements.
- Has explicitly removed default public Overpass use after operator feedback rather than moving load to another free service.

### Strong contributor patterns

**ch-bas**
- Focused CCTV/provider work.
- Exact source provenance, explicit low-confidence states, bounded host contracts, tests tied to actual feed semantics.
- Builds small enabling primitives around real consumers.

**daikaginza**
- Reproduces the premise instead of trusting the issue.
- Reports non-reproduction and severity downgrades openly.
- Exact-main comparison, mutation checks, full gates, and long evidence-rich PR bodies.
- Keeps follow-ups separate instead of broadening a fix.

**Lob26 / ethanstoner / other recent merged fixes**
- Small correctness/resource-bound patches.
- Edge-case tests that catch hazards introduced by the fix itself.
- Measure the real working set / failure mode rather than repeating issue severity.

### Communication rule

Deep evidence belongs in the PR body / downstream packet.
Upstream review comments should be sparse:
observable behavior -> violated invariant -> consequence -> smallest proof/fix.

## 25-pass A/B loop

Each pass compares A against B and records the carrier that better matches recent maintainer decisions.

| # | A | B | Result |
|---|---|---|---|
| 1 | Open another feature | Reduce correctness/security debt | **B** — recent community merges skew strongly toward narrow fixes |
| 2 | Fix each CCTV PR independently | Extract repeated provider invariants | **B** — same URL/body/redirect/provenance bugs recur |
| 3 | Create competing PR | Shepherd existing owned PR | **B** — duplicates #701/#687 lost to smaller existing carriers |
| 4 | Trust issue description | Reproduce current main | **B** — strongest contributors explicitly falsify issue premises |
| 5 | Historical SHA proof | Exact-current-head proof | **B** — stale evidence is treated as context, not acceptance |
| 6 | Broad architecture change | Smallest ownership-correct slice | **B** — maintainers routinely choose narrower duplicate |
| 7 | Unit tests only | Unit + feature gate / real consumer path | **B** — CONTRIBUTING requires runtime gate evidence |
| 8 | Green tests | Negative/mutation proof | **B** — merged reviews praise mutation-tested causal regressions |
| 9 | Helpful fallback | Truthful degraded/unknown state | **B** — provenance is a recurring project value |
| 10 | Infer camera pose/FOV | Preserve uncertainty | **B** — #643 heading-confidence merge is the canonical example |
| 11 | Trust server-registered URL | Validate registration + fetch boundary | **B** — #29 remains open and multiple PRs repeat the gap |
| 12 | Buffer then check body size | Streaming cap / early refusal | **B** — repo is converging on shared capped readers |
| 13 | Follow redirects by default | Manual same-origin/fixed-origin policy | **B** — secret-bearing and media routes require explicit policy |
| 14 | Add a new helper | Extend an existing canonical helper | **B** — #581 review rejected duplicate capped-reader work |
| 15 | Optimize PR count | Optimize maintainer minutes saved | **B** — duplicate closure and maintainer integration dominate outcomes |
| 16 | Utility with no consumer | Primitive with current consumer | **B** — maintainer explicitly requested this on #188 |
| 17 | Vendored scraped dataset | Runtime official source / explicit rights | **B** — CONTRIBUTING rule + recent camera review pattern |
| 18 | Public free service because keyless | Respect aggregate operator capacity | **B** — #648 is decisive |
| 19 | UI claim from approximate data | Label/suppress unsupported precision | **B** — product is explicit about modeled/inferred data |
| 20 | Comment from diff inspection | Trace real consumer serialization/path | **B** — King County model-field finding demonstrates this |
| 21 | Screenshot/anecdote | Frozen fixture A/B | **B** — accepted PRs use exact before/after behavior |
| 22 | Machine-specific workaround | Cross-platform QA contract | **B** — #770/#771 directly affects contributor evidence |
| 23 | Pick maintainer taste externally | Ask only where wording/product choice is irreducible | **B** — #775/#778 should remain decision points |
| 24 | Large upstream spray | 3–5 downstream pilots | **B** — preserves feedback bandwidth and avoids comment spam |
| 25 | Expand on activity/replies | Expand only on merge/salvage/test/code change | **B** — engagement is not the metric |

## Controlled experiment design

### Primary metrics

For every pilot, record whether it produces one of:
- maintainer code change;
- contributor code change;
- new causal regression test;
- merge / salvage / explicit duplicate disposition;
- concrete maintainer decision that removes ambiguity.

### Secondary metrics

- maintainer review minutes removed;
- number of open PRs/bugs a shared invariant closes;
- amount of duplicated code/test work deleted or avoided;
- exact-main reproducibility;
- consumer paths verified.

### Non-metrics

Do not count:
- replies;
- reactions;
- number of comments;
- number of PRs opened;
- “looks good” reviews without independent evidence.

### Stop conditions

Stop a lane when:
- current main already fixes it;
- another PR owns the same fix better;
- the premise cannot be reproduced;
- source rights / provider contract are unclear;
- required runtime evidence cannot be produced safely;
- the change needs a maintainer product decision before implementation.

## Pilot wave — run these in parallel

### P1 — Provider body-bound convergence: PR #581

Target: https://github.com/bilawalsidhu/gods-eye-view/pull/581

Goal: determine whether #581 is now the smallest correct carrier for the remaining unbounded provider reads.

Required work:
- compare its current head against frozen/current main;
- verify every claimed unbounded call still exists on main;
- confirm it extends `readResponseBytesCapped` / existing readers rather than duplicating them;
- check deadlines cover headers + body;
- check rejection bodies are released;
- check package-boundary ownership after the refactors;
- run full gates + relevant provider tests in a restricted environment;
- mutation-check at least one declared-size and one chunked oversize path.

Return:
- `KEEP`: candidate is current, causal, and gate-clean;
- `REVISE`: exact remaining edits;
- `KILL`: main/other PR already supersedes it.

No upstream comment until the packet contains exact head/base SHAs and execution receipts.

### P2 — Alpha-5 satellite correctness: PR #767

Target: https://github.com/bilawalsidhu/gods-eye-view/pull/767  
Issue: https://github.com/bilawalsidhu/gods-eye-view/issues/751

Goal: independently validate the compact correctness fix before offering review support.

Required work:
- verify Alpha-5 mapping against an authoritative public definition;
- drive the real three catalog-builder sites with a local multi-satellite Alpha-5 fixture;
- prove old main collapses them to one `NaN` key;
- prove candidate preserves all identities;
- test I/O-skipped alphabet semantics and five-digit compatibility;
- run full gates and the nearest satellite feature gate available without live credentials;
- inspect whether the helper belongs at the selected package owner.

Do not add scope beyond catalog-number decoding.

### P3 — Transit QA portability: PR #771 vs #402

Targets:
- https://github.com/bilawalsidhu/gods-eye-view/pull/771
- https://github.com/bilawalsidhu/gods-eye-view/pull/402
- https://github.com/bilawalsidhu/gods-eye-view/issues/770

Goal: choose the smallest canonical carrier; do not merge two browser-resolver dialects.

Required work:
- reproduce the current-main startup failure on Linux and, if available, Windows;
- compare the resolver shape in #771, #402, and existing `qa-firms`;
- identify overlap/non-overlap precisely;
- test env override, Puppeteer cached browser, macOS fallback, and sync-throw behavior;
- record ARM64 limitation separately from ordinary Linux/Windows;
- prefer extending an existing resolver/helper only if it is already canonical; do not invent one merely to deduplicate three lines.

Return one sequencing recommendation, not two approvals.

### P4 — Silent share restore failure: issue #776

Target: https://github.com/bilawalsidhu/gods-eye-view/issues/776  
Dependency context: https://github.com/bilawalsidhu/gods-eye-view/pull/744

Goal: build the smallest consumer of the already-computed `layerStateInvalid` signal.

Before coding:
- merge-tree / overlap check against #744;
- confirm the signal is still written and has zero production consumers on current main;
- trace existing deferred share-restoration notice ownership.

Candidate constraints:
- no change to fail-closed decode semantics;
- no salvage of unknown tokens;
- reuse existing deferred notice path and wording style;
- one regression proving invalid layer state no longer looks successfully restored;
- valid empty and valid known-token links remain silent.

If #744 must land first, return `REVISE: stack-after-744` instead of opening a competing PR.

### P5 — Server geocoding salvage: PR #693

Target: https://github.com/bilawalsidhu/gods-eye-view/pull/693  
Issue: https://github.com/bilawalsidhu/gods-eye-view/issues/363

Goal: determine whether the current conflicting PR can be salvaged cleanly onto main.

Required work:
- rebase/merge-tree against current main;
- verify the original browser-web-service key conflict still exists;
- verify server-key precedence, timeout through body read, response-size cap, fixed error text, rate limiting, and keyless fallback semantics;
- prove browser bundle no longer needs Geocoding API permission for search;
- run location-controls feature gate and full gates;
- if no real Google key is available, label keyed E2E `NOT TESTED` rather than pretending the stub proves it.

## Expansion wave — unlock only after pilot evidence

### E1 — Lithuania #607

Only after confirming its prior `terrain/heights` failures against current main.
Rebase, rerun `test:track`, then promote if the source-pack gates are green.
Do not waive a red gate merely because it was previously observed on base.

### E2 — A22 Italy #155 / downstream PR #2

Wait for exact 13-camera media/position/terms receipts.
Promote only stable official still URLs with authoritative positions and honest heading confidence.

### E3 — Québec #445 / downstream PR #1

Wait for a direct-media contract.
Do not implement an HTML-viewer-as-image path.

### E4 — CCTV review follow-ups

Recheck heads before replying:
- #644 WSDOT;
- #645 King County;
- #595 Catalonia;
- #646 Sweden;
- #674 Maryland/DC;
- #752 QLD;
- #660 Spain;
- #620 Vancouver;
- #452 datasheet FOV;
- #670 Taiwan.

Post again only if:
- contributor changed code and a finding needs revalidation;
- a maintainer asks a question;
- new current-head evidence changes the disposition.

### E5 — Share-token #744

Do not duplicate the already-thorough independent review.
Useful work is either:
- a missing two-character application-level proof; or
- a concrete issue discovered while testing its real restore path.

### E6 — Spatial primitives (#749 / #739 / #274 / #188)

Sequence rather than compete:
1. exact correctness landmine;
2. canonical distance primitive;
3. spatial-query primitive with a current consumer.

Preserve intentionally local approximations where they solve a different problem.

### E7 — Overpass offload #742

Treat #648 operator feedback as a hard product constraint.
No new default public-Overpass workloads.
Only review #742 where evidence identifies a concrete regression in the new vector/local path.

## Hold / decision-required

Do not code these until maintainer direction:
- #775 HUD nautical-zone wording;
- #778 Realtime input transcription / second-model cost contract;
- #29 full CCTV SSRF policy where operator-configured local URLs and public-pack URLs need an explicit trust-class decision.

Static research is allowed; upstream implementation is gated.

## Worker protocol

Every worker response must include:

```
lane:
base_sha:
candidate_sha:
status: KEEP | REVISE | KILL | BLOCKED
TESTED:
NOT_TESTED:
SUPPORTED:
UNSUPPORTED:
UNKNOWN:
collision_check:
consumer_path:
negative_control:
full_gates:
feature_gate:
upstream_action_recommended:
```

Rules:
- no upstream posting;
- no secrets or maintainer local env;
- run untrusted PR code only in restricted/disposable environments;
- exact head must be re-read immediately before any later upstream action;
- preserve contributor authorship;
- distinguish static proof from executed proof;
- if a claim fails falsification, record the negative result and kill the lane.

## Promotion rule

Expand the wave only when at least **2 of the 5 pilots** produce a merge-relevant outcome:
- candidate code changed;
- maintainer decision changed;
- causal regression was added;
- a PR becomes demonstrably ready;
- duplicate/stale work is retired.

If fewer than two do, do not increase volume. Re-run discovery with the new maintainer feedback.
