# Historical-style synthetic relief road-outage replay (data only)

Status: downstream `LIMITED` experiment, no upstream/public-safety claim. Owner: [HUM-15 #152](https://github.com/kvnloo/gods-eye-view/issues/152), parent [matching draft #224](https://github.com/kvnloo/gods-eye-view/pull/224), [capacity reference draft #225](https://github.com/kvnloo/gods-eye-view/pull/225), and [MATH-GEV-03 #207](https://github.com/kvnloo/gods-eye-view/issues/207).

## Purpose and strict data boundary

Test that **a changed access observation makes previous logistics calculations non-current and forces re-evaluation**, without accidentally turning hypothetical route availability into an assertion about real infrastructure.

The example is a completely **fictional Idai-style** scenario. It has no historical cyclone Idai coordinates, needs, access reports, real recipients, organization inventory or verified transport conditions. Stock, fleet, need, windows, zone IDs, priorities and route times are explicitly authored synthetic values. No personal information or operational plan is included.

## Existing primitives, not a new solver

- `src/data/reliefCapacityBenchmark.js` is the existing single-stop, one-vehicle-one-zone exact finite reference and deterministic nearest-first control. All numerics come from that owner.
- `src/data/reliefOutageReplay.js` takes a complete `hypothetical/synthetic` baseline fixture and an explicit changed vehicle–zone access edge, distinct access + route revisions and a new synthetic evidence reference. It rejects absent, unknown or already blocked edges as closure targets.
- The adapter runs the **same** solver before and after changing one edge from `supported` to `blocked`, copies no external feeds, retains unchanged need/stock/fleet/policy/world revisions, declares the earlier result stale, and emits a neutral delta. Unknown access elsewhere stays unknown, and the outcome is labeled `limited`.
- Missing route rows, missing revisions, unauthorized data, stale evidence labels, or unsupported model sizes do not generate a comparable result. Numeric upper bounds under unknown access are *not achievable delivery promises*.
- It returns an immutable, versioned, local-only receipt with `authority: none`, `implementation: not-authorized`, and `accessClaim: not-evaluated`. No routing directions, controller actions, dispatch or field claims.

## Synthetic example (not a field result)

One source depot has 5 fictional aid units; vehicle capacities are 4 and 1. Two zones request 4 and 1. On synthetic r1, a critical route is declared supported; under explicitly authored r2 it is blocked.

| Comparison | Exact served units | Nearest-first served units |
| --- | ---: | ---: |
| Baseline synthetic access r1 | 4 | 2 |
| Modified synthetic access r2 | 2 | 2 |
| Delta r2 - r1 | -2 | 0 |

The unchanged nearest-first value does not imply resilience; the exact method's sensitivity does not prove a better real-world policy. A **non-critical** outage test intentionally reports zero change rather than manufacturing a gain.

## Verification and gating

- Focused local tests under **Node 22.16.0**: original matching (13), capacity (16), new outage replay (12) = **41/41 pass**. New replay tests check evidence revision advances, counterfactual delta, unknown/blocked/missing cases, input immutability, unchanged policy constraints, independent recomputation and non-critical zero-delta case. Source/test bytes were read back and must be compared with local Git blob hashes.
- **GEV requires Node 24.14+ or Node 26**. Supported Node 24/26, pinned Prettier format, full npm test/build/boundaries, browser validation, NGO/practitioner value, rights and real-world measurements are NOT verified. Do not mark READY or originate a PR from this focused Node 22 run.
- Next trial: freeze a legal historical or fully synthetic scenario packet with an explicit graph/network/access source and a human-reviewed requirements baseline; test a source-revision invalidation path through existing GEV World/Relief Packet consumers, then compare practitioner accuracy vs a conventional map/spreadsheet. This requires no new solver and no new authority owner.

## Mathematical relevance and provenance

OpenAI mathematical family [#120](https://github.com/openai/math/blob/main/lean/docs/120.md) concerns unweighted matching in general graphs and **is not used here**. The capacity-aware reference and the replay are conventional exhaustive synthetic algorithms. This work tests a product-facing correctness boundary, not a new theorem or a speedup.

GEV and its architecture originate with **Bilawal Sidhu and other contributors**; humanitarian/route-claim contracts and benchmark ideas originate in earlier #137, #141, #152, #207 and draft #224/#225 contributions. Credit independent original graph-matching researchers and OpenAI's catalogue for mathematical context. ChatGPT generated this bounded draft at Kevin's direction; no independent human signoff, underlying dataset consent or upstream approval is claimed.
