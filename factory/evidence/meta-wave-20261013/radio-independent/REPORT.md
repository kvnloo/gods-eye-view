# #816 independent qualification — FAIL CLOSED

**Candidate:** `34e6516161de5bdc52f19aea746f42f53ef2b5f8`

**Pinned main:** `132b9e96dc1491e5db8bf949b1560f4561c925c3`

**Original owner:** `19372875e21266caebe54976c9be73f1d36a73b8`

## Verdict

**The missing reachable Radio ownership proof is CLOSED. Overall independent non-regression qualification remains HELD (`verdict.json: passed=false`).**

Matched full Radio runs expose two candidate failures absent from this baseline:

1. **HUD-off → Tactical ownership:** `contextHiddenWhileDisplayOwnsLane=false`, although Context was collapsed and Display expanded.
2. **Closing Tactical lane owners:** temporary Data and Context remained collapsed with their auto-collapse markers uncleared.

These are observed test failures, not a diagnosed deterministic production bug. The first candidate run exposed different additional failures (sparse labels, manual Radio/voice takeover and optimizer HTTP 504s). A repeat changing which assertions fail does not establish no regression. No assertion, fixture or source behavior was changed to make the gate green.

## Fresh execution

All ordinary commands used the owned detached checkout and Node **26.5.0**, an independently copied matching dependency installation, isolated HOME/TMPDIR and headless Chromium. Full command arrays, exact HEAD, tracked status and actual **child** exit codes are in the matching JSON receipts; the Python wrappers themselves can exit zero after recording a failing child.

| Gate | Result | Receipt |
|---|---|---|
| Ownership + rail units | 36 passed, 0 failed | `focused-units.json/.log` |
| Full `npm test` | 6,345 passed, 0 failed, 1 skipped; two Node24-calibrated allocation files intentionally excluded by the unchanged Node26 runner | `full-units.json/.log` |
| `npm run build` | exit 0 | `build.json/.log` |
| `npm run format:check` | exit 0 | `format.json/.log` |
| `npm run check:boundaries` | exit 0 | `boundaries.json/.log` |
| Unchanged ownership helper | PASS | `green.json/.log` |
| Same helper, callback-only negative mutation | expected assertion failure, exit 1 | `callback-negative.json/.log`, `callback-negative.patch` |
| Same helper, restored production | PASS | `restored-green.json/.log` |
| Full Radio, first candidate | **102 passed / 5 failed**, exit 1 | `full-radio.json/.log` |
| Full Radio, matched pinned main | **105 passed / 1 failed**, exit 1 | `baseline-radio.json/.log` |
| Full Radio, candidate repeat | **104 passed / 3 failed**, exit 1 | `candidate-repeat-radio.json/.log` |

The ownership assertion passed in **both** candidate full-gate runs. The baseline and both candidate runs still fail the original clean-console check for keyless `/api/google/tiles-token` HTTP 404. Initial candidate execution additionally retained an outdated Vite optimizer 504. That 404 is independently baseline-confirmed; the two repeat Tactical failures are **not** labelled inherited.

`npm run test:track` was **not freshly rerun** in this independent pass. Original main and candidate tracking receipts are retained unchanged (owner-reported candidate 109/109); they are recovered evidence, not this reviewer's new execution. Hosted CI, authorization and publication remain unqualified and untouched.

## Closed code and evidence findings

- Both required ancestor SHAs are retained. Full main-to-candidate and owner-to-candidate diffs are archived. Git's replayed merge conflicts only in CHANGELOG; both conflicting entries and contributor credits survive. Pinned-main CHANGELOG and runtime-reference text are preserved verbatim with additions; no format registrations were removed.
- `src/ui/panelChrome.js` is byte-identical to the original owner. Main has no later changes to that file since their common ancestor. All unrelated owner-to-main changes are preserved as exact main blobs/modes.
- The 132-line helper is integrated into the **existing** Radio gate. Removing only its import/invocation produces the prior gate byte-for-byte; the original console/HTTP assertions remain unchanged. No new security issue was found.
- The browser path does **not** seed classes, disclosure flags, geometry or fake DOM. Setup `page.select` operations are synthetic native-select events; the decisive restoration is trusted keyboard input. Native options and the normal change handler were inspected. After compact opening, both mutation and restored runs record **zero pointerdown/click events**, 64 trusted keydown events and one trusted change to Minimal.
- Reverting only constructor callback wiring makes the unchanged helper fail exactly `restored Context must dismiss compact Radio`. Restoring bytes makes it pass. The old unit control manually wires the callback; the browser negative control supplies the missing assembled-seam sensitivity.
- Independently inspected settled screenshots show compact Radio covering Contacts/Space Missions under the negative mutation and disappearing under restored source. Negative Context overlap is **244 × 59.890625 CSS px**; restored overlap is zero. Screenshots alone are not the event-sequence proof; event receipts are separately retained.
- GEV's own contract permits the existing class and unit `classList` doubles. No unrelated no-classes rule was imposed. The Tactical test's unsupported reachability comment is correctly replaced with an isolated scheduler-control description.
- **Historical strict TDD is not certified:** recorded production commit precedes its first unit-test commit; the later rail change and scheduler test share a commit. Today's RED/GREEN proves sensitivity, not historical RED-first order.

## Evidence map

Artifact root: `.//radio-independent`

- Formal verdict: `verdict.json`
- Detailed source/contract/fixture review: `REVIEW-NOTES.md`
- Complete diffs: `main-to-candidate.diff`, `owner-to-candidate.diff`, `new-helper.diff`
- Preservation: `ancestry-preservation.json`, `static-audit.json`, `merge-replay.log`, `merge-resolution.diff`
- Full gate comparison, exact failure details: `full-gate-comparison.json`
- Native-event and settled-geometry summary: `browser-proof-summary.json`
- Negative final image: `callback-negative/settled-after-helper.png`
- Restored final image: `restored-green/settled-after-helper.png`
- Per-run event/console observations: corresponding `ownership.json` and `independent-observations.json`
- Original immutable receipts and bundle: `original-receipts/`, indexed and hash-verified in `protected-originals.json`
- Reproduction wrappers: `runtime.py`, `replay.mjs`, `negative-control.py`, `compare-full.py`

The helper's own rectangle sample can precede rail settlement, so stable after-helper geometry/images were captured by the external wrapper without changing assertions. It listens to pageerror only; it does **not** certify clean console in its separate context. The review independently retained console errors there.

No implementation fix, commit, push, remote review, CI action, credential access, paid-provider session or user-GUI interaction was performed. Only owned review artifacts/worktree state were written; the temporary production mutation was restored. Source dependency trees and original feedback artifacts were read-only. A local reusable review lesson was added to the active profile's frontend receipt reference.
