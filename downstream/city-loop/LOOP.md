# City loop v2: rules (fork-only experiment)

This folder is a fork-only harness (`kvnloo/gods-eye-view`, branch `exp/city-loop-v2`). It is not bound for
upstream. It judges **real app captures** of the GEV city builder. Generated stills are never judged as
candidates. Why v2 exists: the v1 loop (81 rounds, 24.9 h) optimized gpt-image-2 stills, its judges were noisy
(the task layer decided 71/81 rounds and the noise test failed), its rubric and anchor drifted mid-run, it
stamped critic accepts as owner approval (`ideate.py:744 owner_v1`), and its metas could not stop it.

## Roles of each artifact
| Artifact | Role | Can it be "accepted"? |
|---|---|---|
| App commit (SHA) + its capture | **Candidate** | Only Kevin accepts, against that SHA |
| AI postcard (img2img of a real capture) | **Target** per beat (dream-loop step 1), labelled `AI LOOK - NOT EVIDENCE` | Never |
| concepts-v1.jpg | Frozen anchor: app shell, verbs, honesty | n/a |
| wintercats A1/A2 frames | Frozen anchor: look (owner choice 2026-11-22) | n/a |
| Critic panel output | Ranker / diagnosis, advisory | Never writes approval |

## Fixed capture contract (capture/capture.mjs)
- Viewport 1600x1000 @1x. Headless Chrome + SwiftShader (ANGLE). Vite dev server of the app checkout.
- Google Photorealistic 3D Tiles via `CESIUM_ION_TOKEN` (ion asset 2275207). `manifest.tiles.rendering` must be
  `google-photoreal-3d-tiles`, or the round is INVALID.
- Plot `plot-n105201-126637` (QA default; Washington Square, SF). Site camera from `siteForPlot` (600 m, north).
  Sun pinned at `2026-06-21T15:00:00Z`; the shadow beat uses the app's own winter-noon + FIT TO SUN controls.
- Beats: district (far, 1500 m), select (wheel), reimagine (fixture concept + AI chip), build (MASSING),
  shadow (PROTECT SIDEWALK + FIT TO SUN), growth (district + NOW/5 YR/15 YR; the beat image is 15 YR).
- Every beat also gets the Cozy Valley post chain (`filter/cozyValley.js`, arm a): full and a 50 % compare wipe.
- A ~28 s MP4 cut of click -> wheel -> reimagine -> build -> shadow -> timeline is made from the recorded run.
- `manifest.json`: app SHA, URL, beats, sha256 of every file, frame timing, tiles evidence. Images are gitignored.

## Round rules
1. **Round cap 6.** Round 0 = baseline only (no code change).
2. **One attributable change per beat per round.** Each candidate is an app commit on a fork-only branch with a
   one-line hypothesis naming the beat and the gap class (POST/LOOK, FORM, HUD, JUICE, LAYOUT).
3. **Breadth first.** Rank defects by visible area x severity and fix the cheap large ones first.
4. **Change-technique rule.** If the same defect (by ledger id) survives 2 rounds, the 3rd attempt must use a
   different mechanism class (for example post-grade -> stylised mesh kit -> image overlay). Renaming it does
   not reset the count.
5. **Frozen rubric and anchors.** `critics/rubric.json` (sha256 in every verdict file) and the anchors above do
   not change during the run. A change is a new run, so scores across versions are not comparable. Never
   re-point an anchor at the loop's own output.
6. **Panel.** At least 3 judges, at least 1 non-Claude (Codex gpt-6.2-sol + Claude sonnet + Claude opus). Each
   pairwise call runs in both A/B orders: a judge that flips counts as TIE, and the panel needs a strict
   majority. Absolute floor: ship needs every beat >= 2 on every layer **and** Kevin's yes.
   Calibration (`critics/calibrate.py`) must reproduce Kevin's order (form "trash" < #330 "slop" <
   concepts-v1 "much better") on the taste layers before the panel may rank. A layer that fails stays
   advisory-only.
7. **Meta review every 3 rounds** (Fable via `advisor-lane --model opus`). The meta may REDIRECT (switch the
   technique or lane) or STOP. Either decision is binding, is logged in `meta.jsonl`, and is sent to Kevin.
   A redirect never means idling: the work moves to the queued lane.
8. **Checkpoint every round = an owner gallery.** For each beat it shows TARGET (postcard) | previous |
   candidate, plus the MP4. The loop asks Kevin one question: **ship, more of X, or stop?**
9. **Owner verdicts.** `owner-verdicts.jsonl` takes rows only from Kevin's own words (`from_owner: true`,
   verbatim quote, date, SHA when the verdict is on a build). Critics, metas and agents never write it.
10. **Honesty.** No numbers are painted into generated pixels. AI imagery is chipped. A missing measurement
    means INCOMPLETE, never PASS.

## Layout
```
capture/   capture.mjs, run_capture.sh   (Playwright; runs on Boat, never npm on the Studio)
filter/    cozyValley.js                 (arm a: real-time post chain; ?look=cozy or injected)
postcard/  postcard.py                   (arm b: img2img targets; ChatGPT subscription route)
critics/   rubric.json, panel.py, calibrate.py
gallery/   build_gallery.py              (owner gallery HTML + contact sheet)
scripts/   fetch_ion_env.sh, install_env_remote.sh (token -> gitignored .env over ssh stdin only)
runs/<round>/  manifest.json, scores (images/videos gitignored)
```
