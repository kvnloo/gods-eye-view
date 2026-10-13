# Relief matching versus capacity-aware assignment: synthetic benchmark

**Status:** fork-only, bounded *hypothetical* research for [HUM-15 #152](https://github.com/kvnloo/gods-eye-view/issues/152) and [MATH-GEV-03 #207](https://github.com/kvnloo/gods-eye-view/issues/207). Stacks on the [one-to-one matching reference #224](https://github.com/kvnloo/gods-eye-view/pull/224).

## Question and counterexample

A maximum number of one-to-one resource/request matches can fail to maximize units delivered. For example:

- One synthetic depot holds **5 units**.
- Vehicle A has capacity **4**, vehicle B **1**.
- Zone A needs **4** units, zone B **1**.
- A can reach A in 8 minutes or B in 1 minute. B can reach only A (1 minute).
- The maximum matching selects *two pairs*: A→B and B→A, but may deliver just **2 units**.
- The exact capacity-aware solver selects *one delivery*: A→A carrying **4 units**; nearest-first also serves only 2.

The latter is **2× more units** than the greedy control in this *synthetic input*. This is not a humanitarian outcome, validated route state, live fleet plan or field performance claim.

## Precise benchmark scope

`src/data/reliefCapacityBenchmark.js` and `src/data/reliefCapacityBenchmark.test.mjs` provide an exact, bounded oracle with an independent nearest-first control. It supports up to **3 depots / 4 zones / 4 vehicles**, a single one-way trip per vehicle, fixed integer unit capacities/stock/needs, simple time windows and explicit complete vehicle→zone access states `supported | blocked | unknown`. Each route requires a synthetic evidence reference; missing entries return unknown. Unknown and blocked routes cannot produce an assignment.

An explicit policy `serve-units-then-priority-then-time` lexicographically maximizes served units, then supplied zone priority weights, then minimizes one-way vehicle travel minutes; ties are deterministic by IDs. The solver returns per-zone unmet need, total units served, explicitly priority-weighted served units, assignments, source/stock/need/access/fleet/policy revisions, an intentionally loose theoretical resource ceiling and `authority: none`. It never turns route geometry, imagery, inferred travel time or missing evidence into permission.

**Not modeled:** return travel, multi-stop vehicle routing, road-congestion feedback, vehicle reuse, loading/unloading time, temperature/cold-chain needs, demand uncertainty, accessibility, fair aid policy, cost, real supply-chain stock, actual beneficiaries or dispatch authorization. Priority weights are synthetic explicit user inputs, not AI-chosen. Vehicle arrival time is one-way travel with optional waiting, not a schedule for a real logistics operator.

## Relation to OpenAI math

[Family #120](https://github.com/openai/math/blob/main/lean/docs/120.md) concerns near-linear randomized maximum-cardinality matching on simple graphs; it does **not** establish algorithms or performance for these stock, time-window, integer-capacity and priority constraints. This toy enumerator is **ordinary exhaustive search**, not #120's new algorithm. It is useful as a negative fit witness and exact small-input oracle.

## Local evidence and next gates

- Focused local tests: **16/16 PASS** for this capacity benchmark, plus **13/13 PASS** for the inherited matching reference in one Node **22.16.0** run (29 total). 165 additional independent, complete 2-vehicle capacity/need/weight combinations, plus explicit objective-tie tests are checked within one of those tests.
- The source/test blobs in the downstream draft are matched to the locally executed versions by SHA. These proofs cover only the authored synthetic fixtures.
- GEV requires Node 24/26. **No supported-runtime CI, full build, Prettier format verification, imported field data, route rights check, or full humanitarian product validation has been completed.** Do not mark a blocker cleared from our Node 22 result.
- Next: compatible Node 24/26 + `npm run format:check` / `npm test` / `npm run build` / boundary checks; then pin a synthetic Idai-style scenario and compare no-outage/one-blocked-edge with the existing humanitarian `Relief Packet` contract. If practitioner validation does not demonstrate improved decisions over a map/spreadsheet workflow, retain only the reusable benchmark.

## Credit and authority

GEV belongs to Bilawal Sidhu and contributors. The humanitarian evidence and test roadmaps are owned by their original authors in #137/#141/#152/#207; previous exact matching reference remains on #224. OpenAI's math paper and all preceding human graph-algorithm researchers retain their original research credit. This simple exact capacity-aware solver and tests were drafted by ChatGPT at the user's request. No independent scientific review, upstream adoption, or human code authorship is claimed. No origin actions or merges are authorized by this draft.
