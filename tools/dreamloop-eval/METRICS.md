# Dream-loop metrics: definitions fixed before experiments

These definitions are fixed before any round is scored with this tool. Changing them is a new protocol version.
Record that change in the round ledger before scoring under it.

## Pairing

Each capture is compared only with the target of its own view. The manifest boundary (`CONTRACT.md`) rejects these:

- a target or class mask whose `view_id` differs from the record's view,
- one target file (by sha256) serving two views,
- a camera mismatch,
- an aspect-ratio mismatch.

A parent and a candidate are compared only on views where both used the same target sha256.

## Normalization

1. Decode both images as 8-bit sRGB and scale to float 0..1. Colour is not normalized (no histogram matching, no white balance), because colour is what we measure.
2. Resize capture and target to the work resolution, 384×256 by default, with area interpolation. The aspect ratios must agree within 1%.
3. `ignore_rects` (image fractions) are set to mid-grey 0.5 in both images and dropped from the class and edge statistics. The open-data train targets use this for their contact-sheet label box.
4. LPIPS and DISTS run on CPU by default (`DREAMLOOP_DEVICE`) so repeated scoring gives identical numbers.

## Metrics (all are distances: lower = closer to the target)

| name | definition | range |
|---|---|---|
| `dists` | DISTS (piq 0.8.0), input 0..1. **Primary.** | ~0..1 |
| `lpips` | LPIPS, VGG backbone (lpips 0.1), input −1..1 | ~0..1 |
| `class_de` | For each OSM class (water, veg, building, road, other): CIE76 ΔE between the mean CIELAB (D65, L 0..100) of the render and of the target over that class's pixels. Area-weighted mean over the classes present. | 0..~100 |
| `class_spread_de` | The same, with the per-channel Lab standard-deviation vectors (a proxy for contrast and texture inside a class) | 0..~100 |
| `edge_dist` | 1 − Pearson correlation of Sobel gradient magnitudes after a 5-tap binomial blur of Rec.601 luma, over valid pixels. 0 = edges line up, 1 = unrelated, 2 = inverted. | 0..2 |

The class map is the capture's own OSM classification of that view. The same map applies to render and target, because
the target is layout-locked to the view.

DISTS and LPIPS match `apploop/loop.py` bit for bit (measured: max |Δ| = 0 on 30 views × 3 builds). `edge_dist`
is not comparable with the old `1 − edge_cos`: the blur, padding and label-box masking differ, by up to 0.04 per view.
`class_de` is not the old GEV-G `de` term either: the Lab conversion differs and this one has a minimum class area.

## Missing data

- **Missing class:** a class takes part in a view only if it covers ≥ 0.5% of the labelled pixels. An absent class is
  reported with its pixel count and no ΔE (never 0). The weights are renormalized over the classes present.
  Mask value 255 means unknown and is excluded.
- **No class present** → `class_*` unavailable for that view (`no_class_pixels`). **No mask** → unavailable (`no_class_mask`).
- **Flat image** (no gradient) → `edge_dist` unavailable (`flat_image`).
- **LPIPS/DISTS cannot load** (missing package, weights or device) → `score` exits non-zero with
  `METRIC UNAVAILABLE` and writes nothing. Leave the metric out with `--metrics`, which the scores file records. The tool never substitutes another metric.
- Unavailable views count against coverage (`n/expected`). The report check `metrics_complete` fails if any view
  of any requested metric is unavailable. `incomplete`/`excluded` captures count against coverage and are never scored.

## Global score and spread

- **Global score = the panel median of `dists` over scored views, reported for TRAIN and HELD-OUT separately.** There is no
  weighted composite. Reason: in the r00 anchor check (raw mesh vs the owner-approved v3), DISTS ranked the raw mesh worse on
  both panels. The GEV-G composite and LPIPS ranked it better, because they reward photo edges (`apploop/PROTOCOL.md`).
  The other metrics are diagnostics.
- **Spread = the interquartile range** (p25..p75, linear interpolation, numpy's default), plus min/max and `n/expected`.

## Candidate vs parent

- Per-view Δ = candidate − parent on the same view and the same target. Negative = the candidate is closer.
- Per panel: median Δ, IQR of Δ, and better/worse/tie view counts. A view missing on either side is counted in
  `views_in_either` and left out of `views_paired`. It is never treated as zero.

## Noise floor (repeatability)

- Needs ≥ 3 recaptures of one unchanged build: same `build_id`, distinct `run_id`.
- For each run pair, take the panel median of per-view Δ. **floor = max |pair median Δ|**. The per-view |Δ| p50/p95/max
  is also reported.
- `heldout_beyond_noise` passes iff the candidate's HELD-OUT median Δ < −floor. A missing number is reported as
  MISSING, not as a pass.
- Caveat: 3 pairs is a small sample, so the floor is a lower-bound estimate. The loop's preregistered gate can require
  a multiple of it (apploop PROTOCOL.md used −0.001, about 5× the measured floor).

Measured on the open Helsinki set (v3 @ 3c7fba841, runs r00 / r00-aa2 / r00-aa3, 24 TRAIN + 6 HELD-OUT views):

| panel | dists floor | dists per-view \|Δ\| p95 / max | lpips floor | class_de floor | edge_dist floor |
|---|---|---|---|---|---|
| TRAIN | 0.00009 | 0.0013 / 0.0085 | 0.00002 | 0.0029 | 0.0004 |
| HELD-OUT | 0.00021 | 0.0022 / 0.0023 | 0.0001 | 0.0247 | 0.0011 |

## Visible change (parent vs candidate)

- Gaussian blur with σ = 1.5 px at capture resolution, then CIELAB ΔE76 per pixel. A pixel counts as **changed if ΔE76 > 5.0**
  (`--tol`). For reference, ΔE76 ≈ 2.3 is a just-noticeable difference.
- Per view: the share of changed pixels. Per panel: the median and IQR.
- **INVISIBLE if the panel median share is < 5% on every panel.** An invisible round is not a win. Change the approach.
- Measured A/A (v3 r00 vs r00-aa2): median 0.0005% of pixels, max 8.7% on one view. A single-view share is not a round verdict.

## Blind two-seat A/B

- Sample: views where parent and candidate share the target. `k` per panel (default 6 HELD-OUT + 4 TRAIN), drawn with
  `random.Random(sha256(seed | sorted eligible view ids))`. Same seed and inputs → byte-identical packet.
- Seat 1 puts the candidate on X or Y per view by coin flip. Seat 2 shows the same views with the sides swapped.
  Each seat gets its own random item ids and order.
- Judge-visible files (`packet/seatN/`) carry neutral item ids and re-encoded PNGs with no text chunks. They hold no build,
  run, view, panel or role names. `audit_packet` enforces this when the packet is written.
- The unblinding key lives in `sealed/unblind.json`. Verdicts go to `verdicts/seatN.jsonl` keyed by item id only. `tally` joins
  them into `result.json`.
- Default gate (from apploop PROTOCOL.md): the candidate wins ≥ 60% of seats and the parent wins both seats on ≤ 2 views.
  A tie is not a candidate seat. Any missing verdict fails the gate.
