#!/usr/bin/env python3
"""Gen 4 (critic-steered): stage-A panel said the finalists lose scene_integration because de-lighting removes
Google's directional shadows ("r1 has deeper street shadows, clearer geometry"), greens read neon, and texture
reads smeared/blotchy. Keep the parts that won wintercats_fidelity (warm palette, texture-space flatten, DOF
softness) and give back photo luminance."""
import itertools, json
from pathlib import Path

H = Path("/Users/kvn/.hermes/profiles/tek/cache/scratch/arm-shader/cands")
allp = {}
for f in ["g1-all.json", "g2-all.json", "g3-all.json"]:
    for c in json.load(open(H / f)):
        if c.get("params") is not None:
            allp.setdefault(c["id"], c["params"])
common = {"sat": 1.12, "contrast": 1.06, "exposure": 1.03, "kuw": 0.25, "detail": 0.55, "toon": 0.5, "wrap": 0.6,
          "haze": 0.38, "grass": [0.45, 0.72, 0.28], "canopy": [0.17, 0.41, 0.27]}
cands = []
for base, (dl, gs) in itertools.product(["g2-01", "g3-s01"], [(0.3, 1.45), (0.3, 1.75), (0.5, 1.45), (0.5, 1.75)]):
    p = {**allp[base], **common, "delight": dl, "greenSat": gs}
    cands.append({"id": f"g4-{base[:2]}{base[-2:]}-d{int(dl*10)}g{int(gs*100)}", "kind": "cozy2", "parent": base, "params": p})
cands.append({"id": "g4-mix", "kind": "cozy2", "parent": "g2-01",
              "params": {**allp["g2-01"], **common, "delight": 0.4, "greenSat": 1.6, "detail": 0.65, "vpost": 0.25}})
out = []
for c in cands:
    out.append(c)
    out.append({**c, "id": c["id"] + "-clear", "params": {**c["params"], "tiltBlur": 0, "dofBlur": 0, "bloom": 0}})
ctrl = [{"id": "clear", "kind": "clear"}, {"id": "r1", "kind": "r1"}]
for i in range(3):
    part = ctrl + [x for j, c in enumerate(cands) if j % 3 == i for x in out if x["id"] in (c["id"], c["id"] + "-clear")]
    json.dump(part, open(H / f"g4-{i}.json", "w"), indent=1)
    print(i, [x["id"] for x in part])
json.dump(ctrl + out, open(H / "g4-all.json", "w"), indent=1)
