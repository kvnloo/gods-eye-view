# Observed traffic/CCTV review repairs — LIMITED

Canonical queue: https://github.com/kvnloo/gods-eye-view/issues/249 . This is one fork-only support branch over exact #848 head `e9236f7a58c5b3f1b076a67aff8c849867bb08a0`, which contains the #844 source contract. It does not update either origin PR or any default branch.

## Credit and purpose

quanticsoul4772 independently reproduced the disposer/teardown findings on #844 and source/CCTV expiry mismatch on #848. Original GEV source, lifecycle and CCTV authors retain authorship. AI-assisted implementation and synthetic regression work under Kevin's direction; no independent human approval claimed.

Review sources:
- https://github.com/bilawalsidhu/gods-eye-view/pull/844#issuecomment-6224495077
- https://github.com/bilawalsidhu/gods-eye-view/pull/848#issuecomment-6225160179

The numeric/sparse-input checks extend the existing malformed-sibling and missing-versus-zero contract. They do not introduce a new field-source, CV system, clock-skew policy or claim actual humanitarian benefit.

## Repairs

1. Refresh after disposing an observed source returns the existing inert/unconfigured contract instead of rejecting. Required source validation and obsolete-disposer protection remain intact.
2. Disable/destroy invokes the existing observed owner reset, fencing late completion and notifying CCTV subscribers. This is not a claim that third-party producers are forcibly aborted.
3. Numeric coordinates/rates/counts/quality accept finite numbers or decimal strings, not booleans, blank/structured values or alternate-radix strings. Dense geometry admission rejects sparse lines. Genuine zero and decimal exponent notation are preserved.
4. Normalized snapshots carry the source expiry limit; CCTV uses it for both mixed-age snapshots and subsequent cache aging rather than imposing an unrelated five-minute limit. Legacy snapshots retain their fallback.

## Evidence

Combined isolated Node 22.16.0: baseline 30/53 pass, candidate 53/53 pass, zero skipped. Reverting only disposer/reset/admission/freshness independently restores 4/4/8/7 failing cases. These are 53 distinct test bodies: 21 existing source/CCTV tests plus 32 new checks, not a full repository suite.

The complete traffic normalizer and CCTV model run without dependency mocks. Application construction/roads/Cesium/surface/camera collaborators are isolated for disposer and teardown checks; the timing branch is disabled. No live feeds, people, camera images, map renderer or operator outcome was tested. Source and tests were checked by Git blob hashes against pinned heads.

Run in a fully installed checkout using the supported runtime:

```sh
node --test src/data/traffic.disposal.test.mjs src/layers/traffic/observed.test.mjs src/layers/traffic/observed.admission.test.mjs src/layers/traffic/traffic.lifecycle-observed.test.mjs src/layers/cctv/trafficObservations.test.mjs src/layers/cctv/trafficObservations.freshness.test.mjs
```

## Promotion boundary

Re-cut #844's disposal/reset/admission repairs first; then #848's source-TTL projection. Preserve existing maintainers' ownership, rebase current-main i18n/presentation changes, migrate legacy changelog edits, adopt/format new tests, run supported Node 24/26 full suite/boundaries/build and actual browser tests, then obtain scoped origin authority. None of those unrun gates is certified here. The reviewer's future-dated observation finding remains a separate contract decision; no arbitrary allowed clock skew was invented. No new promotion queue or merge.
