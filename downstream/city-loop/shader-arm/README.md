# downstream/city-loop/shader-arm (fork-only, loop v3 arm 1)

Parameter search for `?look=cozy2` (`src/standalone/cozyShaderLook.js`): a Cesium3DTileset.customShader on the
Google photoreal tiles plus a depth-aware post chain, every parameter a live uniform.

Fixed capture contract: same as `capture/capture.mjs` (1600x1000, SwiftShader, plot-n105201-126637, sun
2026-06-21T15:00Z, `cityR1=all`). `search.mjs` reaches each beat once and shoots every candidate on it
without reloading (`window.__gevCozy2.set(...)`); each run carries same-run controls `clear` (no look) and `r1`
(the round-1 `?look=cozy` chain).

```
python3 gen_cands.py lhs --n 24 --seed 11 --prefix g1 --out g1-all.json     # LHS over the search space
python3 split_cands.py g1-all.json 3 g1                                     # one part per sandbox
LABEL=g1-0 CANDS=g1-0.json BEATS=district,build,growth PORT=4311 bash run_search.sh
python3 score_run.py ~/arm/out/g1-0          # proxy-metrics@3.1 (loop-v3 meta lane) vs wintercats A1/A2
python3 gen_cands.py refine --parents ranked.json --n 12 --prefix g2 --out g2-all.json
```

`run_search.sh` expects the app at `~/gev-src` (npm ci, `.env.local` with the ion token, never printed) and
these files in `~/arm/` (refs in `~/arm/refs/`).

Lessons from the run (see loop-v3/arm-shader/REPORT.md in the workspace):
- The proxy rewards raw chroma: a false-colour class-debug frame out-scored every real candidate. Prune with it;
  pick with eyes and the VLM panel.
- Classify hue in sRGB, not linear: linear ratios made shaded asphalt "water" and painted streets neon cyan.
- Google's bay is a dark teal with excess green: vegetation also needs green over blue.

Finalists (`finalists.json`) open with their `url_query` appended to the app URL. Result of this round: the
VLM panel (codex gpt-6.2-sol + claude sonnet + claude opus, both orders) found no candidate that raises
wintercats_fidelity over the round-1 `?look=cozy` LOOK without losing scene_integration. The proxy pushed the
search toward full de-lighting and neon greens, which is exactly what the judges penalise ("lost street
shadows", "smeared green blobs"). Next mechanism, not more tuning: keep photo luminance (hue-only remap), fade
the vegetation class with distance / low-LOD, and drop haze on the district view.
