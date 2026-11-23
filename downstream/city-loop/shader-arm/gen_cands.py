#!/usr/bin/env python3
"""Candidate generator for the shader-arm search (stdlib only).

  gen_cands.py lhs  --n 24 --seed 1 --prefix g1 --out g1.json
  gen_cands.py refine --parents parents.json --n 12 --seed 2 --prefix g2 --scale 0.35 --out g2.json
     parents.json = [{"id":..,"params":{..}}, ...] (best first)
Every file starts with the two same-run controls (clear, r1) so each sandbox run carries its own parent.
"""
import argparse, json, random

SPACE = {  # name: (lo, hi, kind)
    "flat": (0.3, 1.0, "f"), "mipBias": (0.0, 4.0, "f"), "flatR": (1.0, 5.0, "f"),
    "delight": (0.0, 1.0, "f"), "detail": (0.1, 0.6, "f"), "roofVariety": (0.2, 0.85, "f"),
    "greenSat": (1.2, 2.3, "f"), "waterSat": (1.2, 2.3, "f"), "waterVal": (1.0, 1.6, "f"),
    "warmSat": (1.0, 1.7, "f"), "cream": (0.1, 0.9, "f"), "hueSnap": (0.2, 0.85, "f"),
    "vegLo": (0.0, 0.05, "f"), "vegSpan": (0.04, 0.12, "f"),
    "toon": (0.0, 1.0, "f"), "bands": (2.0, 4.0, "f"), "wrap": (0.3, 0.95, "f"),
    "vpost": (0.0, 0.5, "f"),
    "kuw": (0.0, 1.0, "f"), "kuwNear": (1.0, 3.0, "f"), "kuwFar": (2.0, 6.0, "f"),
    "tiltBlur": (0.0, 8.0, "f"), "dofBlur": (0.0, 8.0, "f"), "tiltBand": (0.08, 0.25, "f"),
    "bloom": (0.0, 1.0, "f"), "bloomClamp": (0.03, 0.12, "f"),
    "haze": (0.0, 0.9, "f"), "hazeDensity": (0.0001, 0.0005, "f"),
    "sat": (0.9, 1.3, "f"), "contrast": (0.85, 1.15, "f"), "exposure": (0.95, 1.15, "f"),
}
CONTROLS = [{"id": "clear", "kind": "clear"}, {"id": "r1", "kind": "r1"}]


def finish(p):
    p = {k: round(v, 5) for k, v in p.items()}
    span = p.pop("vegSpan", 0.08)
    p["vegHi"] = round(p["vegLo"] + span, 5)
    p["kuwFar"] = max(p["kuwFar"], p["kuwNear"])
    return p


def to_space(params):
    q = dict(params)
    if "vegHi" in q and "vegLo" in q:
        q["vegSpan"] = q.pop("vegHi") - q["vegLo"]
    return q


def lhs(n, rnd):
    cols = {}
    for k, (lo, hi, _) in SPACE.items():
        perm = list(range(n)); rnd.shuffle(perm)
        cols[k] = [lo + (hi - lo) * (perm[i] + rnd.random()) / n for i in range(n)]
    return [finish({k: cols[k][i] for k in SPACE}) for i in range(n)]


def refine(parents, n, rnd, scale):
    out = []
    for i in range(n):
        base = to_space(parents[i % len(parents)]["params"])
        # every 3rd child crosses over with the next parent
        if i % 3 == 2 and len(parents) > 1:
            other = to_space(parents[(i + 1) % len(parents)]["params"])
            base = {k: (base[k] if rnd.random() < 0.5 else other[k]) for k in SPACE}
        child = {}
        for k, (lo, hi, _) in SPACE.items():
            v = base.get(k, (lo + hi) / 2) + rnd.gauss(0, scale * (hi - lo) / 2)
            child[k] = min(hi, max(lo, v))
        out.append((parents[i % len(parents)]["id"], finish(child)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["lhs", "refine"])
    ap.add_argument("--n", type=int, default=24)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--prefix", default="g1")
    ap.add_argument("--parents")
    ap.add_argument("--scale", type=float, default=0.3)
    ap.add_argument("--out", required=True)
    ap.add_argument("--extra", help="JSON list of extra candidates to include")
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    cands = list(CONTROLS)
    if a.extra:
        cands += json.load(open(a.extra))
    if a.mode == "lhs":
        for i, p in enumerate(lhs(a.n, rnd)):
            cands.append({"id": f"{a.prefix}-{i:02d}", "kind": "cozy2", "params": p})
    else:
        parents = json.load(open(a.parents))
        for i, (pid, p) in enumerate(refine(parents, a.n, rnd, a.scale)):
            cands.append({"id": f"{a.prefix}-{i:02d}", "kind": "cozy2", "parent": pid, "params": p})
    json.dump(cands, open(a.out, "w"), indent=1)
    print(a.out, len(cands))


if __name__ == "__main__":
    main()
