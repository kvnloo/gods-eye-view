# Round 1 (fork-only): receipts

- Branch `exp/city-loop-r1` (parent `exp/city-loop-v2` f81b247 = city/consolidated 23206e62 + harness).
- Product switches: `?look=cozy` (src/standalone/cozyValleyLook.js) and `?cityR1=ghost,flat,kit,chip,tray|all`
  (src/data/cityLookFlags.js). No switch = the parent build.
- Targets: `postcard/postcard_r1.py` (painterly low-poly, spec countables, strict-count v3/v4). `TARGET.json` lists the
  kept variant per beat, sha256 and every reject with its fact-check reason. Images are gitignored (owner gallery copy).
- Captures this round are DIAGNOSTIC: the Cesium token was not installed on the capture box (no approved stdin channel),
  so parent and candidate ran on keyless Esri imagery (`manifest-*.json`: `tiles.rendering = imagery-globe:esri-imagery`).
  Under LOOP.md that is INVALID for promotion; panel files are provisional rankers only.
- To finish the round on photoreal: install the token in both app dirs, then `bash scripts/run_r1.sh <r1-dir> <parent-dir> <out>`,
  rerun `critics/panel.py pairwise` on parent vs r1-all per beat and rebuild with `gallery/build_gallery_r1.py`.
- `rounds.jsonl`: every candidate, trial and reject of this round. Owner verdicts go only to owner-verdicts.jsonl.
