#!/usr/bin/env python3
"""Score one round with the calibrated panel and write scores.json for the gallery.

  score_round.py --round-dir runs/r0 --beat-src beat=dir,... --anchor concepts-v1.jpg --out runs/r0/scores
Calls panel.py (absolute on CAPTURE and COZY per beat; pairwise CAPTURE vs concepts-v1 on the taste layers;
pairwise CAPTURE vs COZY on look/scene/legibility). Both orders, 3 judges. Advisory unless calibrated.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BEATS = ["district", "select", "reimagine", "build", "shadow", "growth"]
CTX = {
    "district": "far/district zoom of the city builder inside the GEV globe app",
    "select": "a plot was just clicked; the verb wheel is shown",
    "reimagine": "the player chose REIMAGINE on the plot; an AI concept is shown",
    "build": "the player turned on MASSING: a proposed building stands on the plot",
    "shadow": "the player opened the shadow/sun-fit study for the proposed building",
    "growth": "the district growth timeline (NOW / 5 YR / 15 YR) at 15 YR",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--beat-src", required=True)
    ap.add_argument("--anchor", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--calibration", default="")
    a = ap.parse_args()
    src = dict(p.split("=", 1) for p in a.beat_src.split(","))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    items, pairs = [], []
    for b in BEATS:
        d = Path(src.get(b) or src["*"])
        cap, cozy = d / f"{b}.png", d / f"{b}--cozy.png"
        if cap.exists():
            items.append({"id": f"{b}--capture", "image": str(cap.resolve()), "context": CTX[b]})
            pairs.append({"id": f"{b}--capture_vs_anchor", "a": str(cap.resolve()), "b": str(Path(a.anchor).resolve()),
                          "context": f"A: {CTX[b]}. B: a reference concept of the same product.",
                          "layers": ["game_feel", "gev_brand", "scene_integration"]})
        if cozy.exists():
            items.append({"id": f"{b}--cozy", "image": str(cozy.resolve()), "context": CTX[b] + " (with a stylised post-process look)"})
            if cap.exists():
                pairs.append({"id": f"{b}--capture_vs_cozy", "a": str(cap.resolve()), "b": str(cozy.resolve()),
                              "context": f"the same frame ({CTX[b]}) with two different render looks",
                              "layers": ["wintercats_fidelity", "scene_integration", "legibility"]})
    (out / "items.json").write_text(json.dumps(items, indent=1))
    (out / "pairs.json").write_text(json.dumps(pairs, indent=1))
    py = [sys.executable, "-B", str(HERE / "panel.py")]
    subprocess.run(py + ["absolute", "--out", str(out), "--items", str(out / "items.json"), "--name", "absolute"], check=True)
    subprocess.run(py + ["pairwise", "--out", str(out), "--pairs", str(out / "pairs.json"), "--name", "pairwise"], check=True)
    A = json.loads((out / "absolute.json").read_text())
    P = json.loads((out / "pairwise.json").read_text())
    calib = json.loads(Path(a.calibration).read_text())["verdict"] if a.calibration else {}
    adv = set(calib.get("advisory_only_layers", []))
    res = {"rubric_sha256": A["rubric_sha256"], "advisory_only_layers": sorted(adv), "beats": {}, "pairs": {}, "defects": []}
    for iid, s in A["summary"].items():
        b, arm = iid.split("--")
        res["beats"].setdefault(b, {})[arm] = {k + ("*" if k in adv else ""): v for k, v in s["mean"].items()}
        for j, det in A["detail"][iid].items():
            for d in (det or {}).get("defects", []):
                res["defects"].append({"beat": b, "arm": arm, "judge": j, **d})
    for pid, s in P["summary"].items():
        res["pairs"][pid] = s["panel"]
    (out / "scores.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({"beats": res["beats"], "pairs": res["pairs"]}, indent=1))


if __name__ == "__main__":
    main()
