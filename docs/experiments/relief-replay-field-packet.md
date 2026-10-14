# Relief Replay → offline Field Lite packet (synthetic, read-only)

**Downstream status: LIMITED.** Follows [GEV #11](https://github.com/kvnloo/gods-eye-view/issues/11) (World/Relief Packet), [#146](https://github.com/kvnloo/gods-eye-view/issues/146) (Field Lite), [#152](https://github.com/kvnloo/gods-eye-view/issues/152) (relief logistics), and [draft #226](https://github.com/kvnloo/gods-eye-view/pull/226) (synthetic road outage).

## Boundary and upstream dependency

GEV's reusable World Packet is proposed in [upstream PR #880](https://github.com/bilawalsidhu/gods-eye-view/pull/880), which remains unmerged as of October 13, 2026. Do not import its `src/agent/worldPacket.js` from this draft: that would couple two unrelated pending PR stacks, pull Cesium into a local-only data path, and create confusion between live viewport observations and simulation outcomes.

The adapter `projectReliefOutageFieldPacket(replay, {worldPacketReference?})` accepts the **already-computed, pure synthetic replay receipt** and optionally an opaque `{semanticFingerprint,revision}` matching the proposed World Packet fingerprint format. It does not create, interpret or copy a World Packet. That hash is **only identity**, never evidence/authority or cryptographic attestation. The reference revision must match the replay's pinned `worldRevision`; otherwise the output is unknown. No current/stale state is inferred from it.

## Read-only projection

- Frozen schema `gev-relief-replay-field-packet`, version 1, `hypothetical` and `authority: none`.
- Versioned synthetic source, stock, fleet, need, policy and world references; historical and revised access/route revisions; explicit selected-edge closure evidence.
- Distinguishes the **superseded baseline** from the newer *synthetic revision*, never calls a real road open or gives dispatch guidance.
- Each stage contains exact-vs-nearest-first synthetic served units, weighted totals, one-way travel minutes, per-zone need/served/unmet quantities, selected single-stop assignments and their synthetic route evidence. Both unknown route counts and optimistic theoretical upper bounds remain explicit. Bounds are **not guaranteed achievable**.
- `fieldLite` is a small single-column, touch-friendly *data projection* with structured rows, source references and clear notices; `formatReliefReplayFieldText` provides offline non-interactive text, no browser/3D/network dependencies. **No actual GEV field UI, 2D map, World Packet code, or application state is connected yet.** That must be a separate, independently tested UI leaf after the source contracts settle.
- Invalid/falsified status, source, world revision, route evidence, stage totals, closure assignment or objective delta returns `unknown` without fabricated quantities; external mutable input cannot change the frozen output.

## Synthetic fixture and reproducibility

Fictional depot stock 5 and two vehicles with capacities 4+1; two aggregate zones request 4+1. When an explicitly supported synthetic route becomes `blocked` under a new revision, conventional exact capacity assignment changes from 4 to 2 synthetic units. Nearest-first remains 2. The adapter does **not** execute any new allocation algorithm or incorporate historical Cyclone Idai data.

The 3 referenced source/test file pairs from drafts #224, #225 and #226 and the new projection/test files were tested together locally. `node --test src/data/*.test.mjs` passed **60/60** on Node **22.16.0** on an isolated fixture workspace. The new projection adds 19 tests to the existing 41. Published GitHub source blobs and any hosted checks must be verified separately. GEV supports Node >=24.14 or 26; that requirement is **not** met by the local run. Pinned Prettier `format:check`, repository build, browser/Field Lite QA, network licenses, and operator utility are unverified.

## Next promotion gates

1. Run Node 24/26 `npm test`, `npm run format:check`, import-boundary gates and build on the exact PR head (plus genuine browser/2D acceptance if UI is later wired).
2. Check upstream World Packet #880 and core disaster kernel #882; re-cut onto accepted interfaces **instead of merging stacked experimental branches wholesale**.
3. Use a frozen, rights-checked offline access packet and compare the selected evidence/disaster decision tasks against a map/spreadsheet baseline. Report actual task success, errors, usability, offline bytes, p95, and freshness distinctions.
4. Keep all output advisory/synthetic. No autonomous route choice, beneficiary prioritization, sensitive coordinates, CCTV recognition, credential leakage, real-time field dispatch or premature claims of public-health/physical impact.

**Attribution:** GEV was created by Bilawal Sidhu with many contributors. The World Packet and disaster-access seams derive from earlier independent GEV contributors and original draft PRs #880/#882. The existing bounded synthetic matching, capacity, and outage pilots (#224–#226) preserve their respective contributors. OpenAI math #120 is contextual research only, **not implemented by this conventional adapter**. This implementation and tests were generated by ChatGPT at the user's direction; no human reviewer or maintainer approval is inferred.
