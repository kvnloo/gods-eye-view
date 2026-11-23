# downstream/city-loop: dream loop v2 harness (fork-only experiment)

This folder is not meant for upstream. It is a harness that judges **real GEV city-builder captures** on
Google Photorealistic 3D Tiles against frozen targets, using a critic panel calibrated to Kevin's own
verdicts. Read `LOOP.md` for the rules, `BRIEF.md` and `OWNER-PREFERENCES.md` for the targets, and
`owner-verdicts.jsonl` for Kevin's own words. Agents never write approval into that file.

## Google tiles: what may be captured and judged (exp/city-loop-v4)

The Map Tiles API policies forbid image analysis and machine interpretation of
Google Photorealistic 3D Tiles, and the Google and Cesium terms forbid storing
them or putting them in documents (`loop-v3/licence/REPORT.md`). So:

- Critics (the VLM panel, the proxy metrics) and galleries read **judge frames
  only**: `capture.mjs --own` (or `--judge-only`) hides every 3D tileset, checks
  the screen is Google-free, writes `<beat>--own.png` and tags it in
  `manifest.json` `frames` (`"googleTiles": false`, sha256).
  `critics/judge_gate.py check <img>...` refuses everything else; `panel.py`
  calls it for every image. Derived images (jpg, resize) pass only with a
  `judge_gate.py derive` sidecar; non-capture references need a `reference`
  sidecar.
- In-context frames and the recorded journey video can show Google tiles. They
  are written only to one ephemeral dir,
  `$TMPDIR/gev-EPHEMERAL-google-tiles-do-not-copy/` (`--ephemeral-dir` to move
  it; the name must keep `gev-EPHEMERAL-google-tiles`), are for live human
  review only, are never copied into `runs/`, reports, galleries or git, and
  should be deleted after use. `--judge-only` does not write them at all.
- `judge20-<label>.mp4` is the 20 s journey made from the six judge frames.
- Photoreal styling is reviewed in the running app, not from saved files.

## Round recipe
1. Capture machine (Boat; never npm on the Mac Studio): app checkout + `npm ci` + the token:
   `ssh groot 'bash -s' < scripts/fetch_ion_env.sh | <ssh capture-box> 'bash install_env_remote.sh <app-dir>'`
   (the value moves over stdin only and lands in the gitignored `.env`, mode 600).
2. `bash capture/run_capture.sh <app-dir> 4187 runs/<round>/<label> <label> --video`
   produces the 6 beats, Cozy Valley variants (`--cozy`, `--cozy-wipe`, `--cozy-grade-only`), the journey MP4 and
   `manifest.json` (app SHA, URL, sha256 of every file, frame timing, and `tiles.rendering` must be
   `google-photoreal-3d-tiles`). Since exp/city-loop-v4 add `--own --no-cozy` (or `--judge-only`) and
   score only the judge frames; see "Google tiles" above.
3. `python3 postcard/postcard.py --capture-dir … --out … --ref A1.jpg --ref A2.jpg` makes the arm (b) targets.
4. `python3 critics/score_round.py --beat-src '*=<capture dir>' --anchor concepts-v1.jpg --out runs/<round>/scores --calibration critics/calibration.json`
5. `python3 gallery/build_gallery.py …` builds the owner gallery + contact sheet. Send it to Kevin and record
   his verdict against the SHA.

Calibration: `critics/panel.py absolute|pairwise` on the anchor set, then `critics/calibrate.py`
(the result is in `critics/calibration.json`).

The Cozy Valley filter can also be opened by hand in a dev server where `downstream/` is linked into the app root:
`await (await import('/downstream/city-loop/filter/cozyValley.js')).installFromUrl()` with `?look=cozy&lookWipe=0.5`.
