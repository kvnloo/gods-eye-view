#!/usr/bin/env python3
"""make_final.py <out.json> <cand id>...  : full-beat finalist list with LOOK + CLEAR (no tilt/DOF/bloom) variants."""
import json, sys
from pathlib import Path

H = Path("/Users/kvn/.hermes/profiles/tek/cache/scratch/arm-shader/cands")
allp = {}
for f in ["g1-all.json", "g2-all.json", "g3-all.json"]:
    for c in json.load(open(H / f)):
        if c.get("params") is not None:
            allp.setdefault(c["id"], c["params"])
cands = [{"id": "clear", "kind": "clear"}, {"id": "r1", "kind": "r1"}]
for cid in sys.argv[2:]:
    p = allp[cid]
    cands.append({"id": cid, "kind": "cozy2", "params": p})
    cands.append({"id": f"{cid}-clear", "kind": "cozy2", "params": {**p, "tiltBlur": 0, "dofBlur": 0, "bloom": 0}})
json.dump(cands, open(sys.argv[1], "w"), indent=1)
print(sys.argv[1], len(cands))
