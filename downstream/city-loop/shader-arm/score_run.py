#!/usr/bin/env python3
"""Run in a sandbox: score every <beat>--<cand>.png of a search run with proxy-metrics@3.1 vs the wintercats
refs, write <run>/proxy.json: per candidate per beat composite + subs, and the mean over beats.
  python3 score_run.py ~/arm/out/<label> [~/arm/out/<label2> ...]
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / "arm"))
import proxy_metrics as pm  # noqa: E402

REFS = sorted(str(p) for p in (Path.home() / "arm/refs").glob("*.jpg"))
st = pm.reference_stats([pm.frame_metrics(x) for p in REFS for x in pm.load(p)])
for run in sys.argv[1:]:
    run = Path(run)
    rows = {}
    for f in sorted(run.glob("*--*.png")):
        beat, cand = f.stem.split("--", 1)
        if cand.startswith("stage-") or cand == "failure":
            continue
        m = pm.frame_metrics(pm.load(f)[0])
        s = pm.score_against(m, st)
        rows.setdefault(cand, {})[beat] = {"composite": round(s["composite"], 4),
                                           "sub": {k: round(v, 4) for k, v in s["sub"].items()},
                                           "palette_hue_sim": round(s["palette_hue_sim"], 4),
                                           "metrics": pm.public(m), "sha256": pm.sha(f)}
    out = {"version": pm.VERSION, "refs": REFS, "cands": {}}
    for cand, beats in rows.items():
        comp = [b["composite"] for b in beats.values()]
        subs = {k: round(sum(b["sub"][k] for b in beats.values()) / len(beats), 4) for k in next(iter(beats.values()))["sub"]}
        out["cands"][cand] = {"mean": round(sum(comp) / len(comp), 4), "min": min(comp), "beats": beats, "sub_mean": subs}
    (run / "proxy.json").write_text(json.dumps(out, indent=1))
    for cand, v in sorted(out["cands"].items(), key=lambda kv: -kv[1]["mean"]):
        print(run.name, f"{cand:<14} mean={v['mean']:.4f} min={v['min']:.4f} " + " ".join(f"{b}={x['composite']:.3f}" for b, x in v["beats"].items()))
