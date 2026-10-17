# Thumbnail cancellation review repair — LIMITED

Owner: bilawalsidhu/gods-eye-view#881; source head `85227cca9dc0fa74055c5f4e9490fea932f86875`. This fork-only branch does not update the origin PR. Canonical promotion queue: https://github.com/kvnloo/gods-eye-view/issues/249 .

Credit: quanticsoul4772 reproduced the double count in https://github.com/bilawalsidhu/gods-eye-view/pull/881#issuecomment-6221765171 . Original thumbnail/refinement authors retain their authorship. This small repair and regression battery are AI-assisted work under Kevin's direction, not an independent human review.

Invariant: one pending transport can increment the supersession counter at most once. Cancelled known-present refetches retain proven availability/acquisition metadata; successor work still waits for a real free slot. Reentrant retain and prior cancelAll are covered.

Local Node 22.16.0: six new checks, baseline 2 pass / 4 fail; candidate 6 pass; removing the guard restores four failures. Exact source blob before repair: `cd4c8fed7e01d51d204dd0f9322b300c0dc87a61`. The local replay uses the complete loader, fake fetch/object URLs and a URL-builder stub. It does not exercise real NASA requests, original model ordering, GEV browser rendering, or supported Node 24/26 full-suite acceptance.

Run in a full checkout: `node --test src/layers/recentImagery/thumbnails.retain.test.mjs src/layers/recentImagery/thumbnails.test.mjs src/layers/recentImagery/index.test.mjs`.

Remaining before origin publication: rebase the existing owner onto current main, adopt/format the added test with pinned Prettier 3.9.6, repair CURRENT-STATE heading/changelog-fragment placement as requested, run supported full/adjacent gates, and obtain scoped origin authorization. No merge or approval is implied. No new promotion queue.
