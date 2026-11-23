#!/usr/bin/env python3
"""Gen 5: bracket between g2-01 (wins wintercats_fidelity, loses scene_integration 3/3) and gen 4 (ties both).
Judge reasons on g2-01: posterised/smeared tiles, weaker directional shadows. Keep g2-01's palette/flatten/DOF,
partial de-light, less posterise, more toon (normal-derived) shading for directional form."""
import json
from pathlib import Path

H = Path("/Users/kvn/.hermes/profiles/tek/cache/scratch/arm-shader/cands")
g201 = next(c for c in json.load(open(H / "g2-all.json")) if c["id"] == "g2-01")["params"]
variants = {
    "g5-a": {"delight": 0.7, "detail": 0.6, "vpost": 0.2, "toon": 0.65, "wrap": 0.5, "greenSat": 1.9, "sat": 1.2},
    "g5-b": {"delight": 0.75, "detail": 0.65, "vpost": 0.15, "toon": 0.7, "wrap": 0.45, "greenSat": 1.8, "sat": 1.15,
             "grass": [0.45, 0.72, 0.28], "kuw": 0.15},
    "g5-c": {"delight": 0.65, "detail": 0.6, "vpost": 0.2, "toon": 0.6, "wrap": 0.5, "greenSat": 2.0, "sat": 1.25,
             "dofBlur": 5.5, "tiltBlur": 4},
    "g5-d": {"delight": 0.8, "detail": 0.7, "vpost": 0.1, "toon": 0.75, "wrap": 0.4, "greenSat": 1.8, "sat": 1.2,
             "flat": 0.85},
}
ctrl = [{"id": "clear", "kind": "clear"}, {"id": "r1", "kind": "r1"}]
allc = list(ctrl)
for i, keys in enumerate([["g5-a", "g5-c"], ["g5-b", "g5-d"]]):
    part = list(ctrl)
    for k in keys:
        c = {"id": k, "kind": "cozy2", "parent": "g2-01", "params": {**g201, **variants[k]}}
        cc = {**c, "id": k + "-clear", "params": {**c["params"], "tiltBlur": 0, "dofBlur": 0, "bloom": 0}}
        part += [c, cc]
        allc += [c, cc]
    json.dump(part, open(H / f"g5-{i}.json", "w"), indent=1)
json.dump(allc, open(H / "g5-all.json", "w"), indent=1)
print(len(allc))
