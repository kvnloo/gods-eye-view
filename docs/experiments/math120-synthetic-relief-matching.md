# Math372 #120 — synthetic relief matching (reference only)

**Downstream-only experiment.** Existing owner: [GEV relief-logistics #152](https://github.com/kvnloo/gods-eye-view/issues/152) and math feasibility [#207](https://github.com/kvnloo/gods-eye-view/issues/207).

## User question

For a tiny **synthetic** set of interchangeable one-unit resources and requests, how many one-to-one pairs can be matched **using only explicitly supported pairs**? How many *might* be matchable if all currently unknown pairs become supported?

This is **not** capacity-constrained humanitarian logistics, a vehicle-route optimizer, a beneficiary/need allocation policy, a safety assessment, or operational dispatch.

## Input / output contract

`solveSyntheticReliefMatching(input)` requires:
- `determination: hypothetical` and `datasetKind: synthetic`;
- explicit study, world, source, access, request, resource, and policy revisions;
- non-person identifiers for at most eight resources and eight requests;
- **one edge for every resource/request pair** with `supported | unsupported | unknown` and an evidence reference. Omitted pairs are not automatically unsupported.

The pure deterministic result gives a maximum-cardinality assignment **using supported edges only**, the list of unmatched synthetic nodes, and a separate **possible cardinality upper bound** if all unknown edges later become usable. Any unknown edge forces a `limited` status. Missing matrix entries yield `unknown` with **no assignments**.

Never infer a road is accessible because a geometry/routing service returned a path. All outputs remain `hypothetical`, with `authority: none` and `implementation: not-authorized`. Input revision changes invalidate reuse of earlier interpretations.

## Mathematics and evidence

[OpenAI math family #120](https://github.com/openai/math/blob/main/lean/docs/120.md) describes a randomized near-linear maximum-matching algorithm on simple unweighted graphs. **This module does not implement it.** Instead it uses elementary exhaustive enumeration with pruning as an exact small oracle. It cannot model quantity, vehicle capacity, time windows, equity constraints, or general routing.

**Local focused results:** 13/13 tests passed on **Node 22.16.0**, including independent exhaustive checks on all 81 two-by-two three-state edge matrices and 100 seeded three-by-three cases. Complete eight-by-eight connectivity took ~77 ms on the same test runtime (illustrative only, not an application benchmark). Published source/test blob identities must match the tested local snapshot.

**Unverified:** GEV requires Node 24/26; neither supported-runtime tests nor full format, build, browser QA, real humanitarian outcomes or maintainer acceptance are established by this pilot. No production inputs, private identifiers, source feeds or real-road inferences.

## Next gate

Check on supported Node, compare conventional graph matching against this tiny oracle on a deterministic Idai-style **synthetic** fixture, verify capacity-aware problem formulation separately, and run a practitioner validation against maps/spreadsheets before proposing GEV integration. Independent user need and Linear HITL authority are required before any origin write.

## Credit

GEV: Bilawal Sidhu and contributors. Humanitarian/roadmap constraints: GEV #137/#141/#152/#207 authors. Mathematics: OpenAI catalogue plus prior independent graph-matching researchers. Code, synthetic cases and documentation prepared by ChatGPT at the user's direction; no independent human review, deployment or attestations implied.
