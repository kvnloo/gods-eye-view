# downstream/city-loop: dream loop v2 harness (fork-only experiment)

This folder is not meant for upstream. It is a harness that judges **real GEV city-builder captures** on
Google Photorealistic 3D Tiles against frozen targets, using a critic panel calibrated to Kevin's own
verdicts. Read `LOOP.md` for the rules, `BRIEF.md` and `OWNER-PREFERENCES.md` for the targets, and
`owner-verdicts.jsonl` for Kevin's own words. Agents never write approval into that file.

## Round recipe
1. Capture machine (Boat; never npm on the Mac Studio): app checkout + `npm ci` + the token:
   `ssh groot 'bash -s' < scripts/fetch_ion_env.sh | <ssh capture-box> 'bash install_env_remote.sh <app-dir>'`
   (the value moves over stdin only and lands in the gitignored `.env`, mode 600).
2. `bash capture/run_capture.sh <app-dir> 4187 runs/<round>/<label> <label> --video`
   produces the 6 beats, Cozy Valley variants (`--cozy`, `--cozy-wipe`, `--cozy-grade-only`), the journey MP4 and
   `manifest.json` (app SHA, URL, sha256 of every file, frame timing, and `tiles.rendering` must be
   `google-photoreal-3d-tiles`).
3. `python3 postcard/postcard.py --capture-dir … --out … --ref A1.jpg --ref A2.jpg` makes the arm (b) targets.
4. `python3 critics/score_round.py --beat-src '*=<capture dir>' --anchor concepts-v1.jpg --out runs/<round>/scores --calibration critics/calibration.json`
5. `python3 gallery/build_gallery.py …` builds the owner gallery + contact sheet. Send it to Kevin and record
   his verdict against the SHA.

Calibration: `critics/panel.py absolute|pairwise` on the anchor set, then `critics/calibrate.py`
(the result is in `critics/calibration.json`).

The Cozy Valley filter can also be opened by hand in a dev server where `downstream/` is linked into the app root:
`await (await import('/downstream/city-loop/filter/cozyValley.js')).installFromUrl()` with `?look=cozy&lookWipe=0.5`.
