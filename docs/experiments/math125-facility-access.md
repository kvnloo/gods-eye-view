# Exact synthetic facility-access reference (OpenAI math #125)

**Status:** fork-only, small mathematical applicability experiment, not a product feature or municipal decision tool.

## User question

For two alternative neighborhood park or cooling-center sites, what is the **synthetic weighted average walking distance** from aggregated demand zones, and how far must the worst-served nonzero-weight zone walk?

Existing planning owner: [GEV #184](https://github.com/kvnloo/gods-eye-view/issues/184), [branchable community park proposals #185](https://github.com/kvnloo/gods-eye-view/pull/185). Research task: [Math372 #206](https://github.com/kvnloo/gods-eye-view/issues/206). This module does **not** wire into a map, project proposals, live OSM graph, voice, an external service or shared rooms yet.

## What the code does

- Pure, deterministically sorted exact enumerator for at most 12 synthetic aggregated zones, 10 explicitly labeled candidate sites, and `k=1` or `k=2` assumed-feasible sites. All site pairs are enumerated (at most 45), no heuristic.
- Requires `determination: hypothetical`, `datasetKind: synthetic`, stable study/source/baseline/demand/network/metric revision references, integer zone weights, a **full symmetric proper metric** of bounded integer-meter distances, and explicit site eligibility.
- Validates zero diagonal, positive off-diagonal, symmetry, triangle inequality and explicit finite distances. Null/unreachable, asymmetric or missing distances never become zero.
- Reports each feasible alternative's weighted mean walking distance, worst-served positive-weight zone, total weighted distance, nearest site per zone, and explicitly excluded/unknown site eligibility.
- Keeps every result `hypothetical` and `approval: not-requested`. No 'safe' or 'winner' assertion, land rights, observed trip counts, inferred participant locations, real mobility estimates or physical-world effect.
- Returns `unknown`, `infeasible`, `unsupported` or `not-applicable` where applicable. No partial-success estimates on invalid inputs.
- Source code: `src/data/communityFacilityAccess.js` and `src/data/communityFacilityAccess.test.mjs`. External solvers and graph sources retain authority.

## Why this is NOT implementation of #125's new algorithm

[OpenAI family #125](https://github.com/openai/math/blob/main/lean/docs/125.md) claims a deterministic polynomial-time approximation for arbitrary finite **rational metric** k-median. This reference uses ordinary exhaustive combinatorics only for a bounded dataset to obtain exact ground truth. It does not use that approximation, and validates the premise before trying it.

The constrained planning problem (capacity, affordability, zoning, directed walking routes, street crossing accessibility, equitable worst-case service, disaster road closure) may require **different** optimization formulations. Zero demand is distinct from missing demand; observed real data and official decisions are not inferred.

## Validation and next gate

Current local environment has Node 22.16, outside GEV's required Node >=24. Focused tests passed locally **13/13** with an independently implemented exact line-metric reference. Supported Node 24/26, complete project test/build/format suite, browser QA, real walking network validation, accessibility specialists and practitioner value studies remain **unverified**.

Before integration: independently validate a rights-permitted symmetric pedestrian-network metric and aggregated demand, compare against a map/spreadsheet baseline, measure p95 time-to-correct-comparison, add an explicit binding to a specific GEV proposal baseline revision, and preserve all source licenses. No origin-facing write until the OSS factory's independent requirement and Linear HITL gates.

**Credit:** Bilawal Sidhu and original GEV contributors own the application, the authors of #184/#185 the scenario contract. OpenAI math catalogue and any preceding human research contributors own the relevant mathematical claims; this exhaustive control is elementary. Draft code and test plan were prepared by ChatGPT at the user's direction; no independent human review asserted.
