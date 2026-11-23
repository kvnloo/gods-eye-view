#!/usr/bin/env python3
"""split_cands.py all.json n prefix -> prefix-0.json .. prefix-(n-1).json; controls (clear, r1) in every part."""
import json, sys
allc = json.load(open(sys.argv[1]))
n = int(sys.argv[2])
ctrl = [c for c in allc if c["kind"] != "cozy2"]
rest = [c for c in allc if c["kind"] == "cozy2"]
for i in range(n):
    part = ctrl + rest[i::n]
    json.dump(part, open(f"{sys.argv[3]}-{i}.json", "w"), indent=1)
    print(f"{sys.argv[3]}-{i}.json", len(part))
