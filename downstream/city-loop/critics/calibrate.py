#!/usr/bin/env python3
"""Check the panel against Kevin's own ranking before it may rank anything.

Owner order (verbatim reactions): form UI "trash" < #330 shadow-fit "slop" < concepts-v1 "much better".
Look layer (owner choice 2026-11-22): wintercats frames > r081 dashboard frame on wintercats_fidelity.

  calibrate.py --abs calib-absolute.json --pairs calib-pairwise.json --out calibration.json

Item ids are prefixed trash-/slop-/good-/wc-/dash-. Pair ids name the expected winner (see EXPECT).
A layer PASSES absolute calibration if the group means are strictly ordered for the panel mean AND for at
least 2 of the 3 judges individually; it PASSES pairwise if every pair's panel verdict (both orders,
majority) picks the owner's side. TIE counts as a miss. Honesty/legibility are reported but are not expected
to follow the owner's taste order (the form UI was honest), so they are not gating.
"""
import argparse
import json
from pathlib import Path

TASTE = ["game_feel", "gev_brand", "scene_integration"]
EXPECT = {  # pair id -> expected winner label
    "trash_vs_slop": "B", "slop_vs_good": "B", "trash_vs_good": "B", "slop1_vs_good_reimagine": "B",
    "dash_vs_wcA1": "B", "wcA2_vs_dash": "A",
}
ORDER = ["trash", "slop", "good"]


def group_means(summary, layer, judge=None):
    acc = {}
    for iid, s in summary.items():
        g = iid.split("-")[0]
        if judge:
            v = s["judges"].get(judge, {}).get(layer)
        else:
            v = s["mean"].get(layer)
        if v is not None:
            acc.setdefault(g, []).append(v)
    return {g: round(sum(v) / len(v), 2) for g, v in acc.items()}


def strictly(gm, order):
    vals = [gm.get(g) for g in order]
    return all(v is not None for v in vals) and all(a < b for a, b in zip(vals, vals[1:]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--abs", required=True)
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    A = json.loads(Path(a.abs).read_text())
    P = json.loads(Path(a.pairs).read_text())
    summ = A["summary"]
    judges = sorted({j for s in summ.values() for j in s["judges"]})
    # Add a composite "taste" layer = mean of TASTE layers.
    for s in summ.values():
        s["mean"]["taste"] = round(sum(s["mean"][k] for k in TASTE) / len(TASTE), 2)
        for j, sc in s["judges"].items():
            sc["taste"] = round(sum(sc[k] for k in TASTE) / len(TASTE), 2)
    res = {"rubric_sha256": A["rubric_sha256"], "judges": judges, "absolute": {}, "pairwise": {}, "look": {}}
    for layer in A["layers"] + ["taste"]:
        if layer == "wintercats_fidelity":
            continue
        gm = group_means(summ, layer)
        per_j = {j: strictly(group_means(summ, layer, j), ORDER) for j in judges}
        res["absolute"][layer] = {"group_means": gm, "panel_ordered": strictly(gm, ORDER),
                                  "judges_ordered": per_j,
                                  "pass": strictly(gm, ORDER) and sum(per_j.values()) >= 2}
    # Look layer: wc > dash.
    gm = group_means(summ, "wintercats_fidelity")
    per_j = {j: (lambda g: g.get("wc") is not None and g.get("dash") is not None and g["wc"] > g["dash"])(
        group_means(summ, "wintercats_fidelity", j)) for j in judges}
    res["look"]["absolute"] = {"group_means": gm, "judges_ordered": per_j,
                               "pass": gm.get("wc", 0) > gm.get("dash", 9) and sum(per_j.values()) >= 2}
    # Pairwise.
    layer_hits = {}
    for pid, s in P["summary"].items():
        exp = EXPECT.get(pid)
        row = {}
        for layer, v in s["panel"].items():
            ok = v == exp
            row[layer] = {"panel": v, "expected": exp, "ok": ok,
                          "judges": {j: jv[layer] for j, jv in s["judges"].items()}}
            layer_hits.setdefault(layer, []).append(ok)
        res["pairwise"][pid] = row
    res["pairwise_layers"] = {k: {"hits": sum(v), "of": len(v), "pass": all(v)} for k, v in layer_hits.items()}
    # Flip rate: how often a judge's raw verdict changed with order (from detail if present).
    gating = ["taste"] + TASTE
    res["verdict"] = {
        "taste_layers_pass_absolute": {k: res["absolute"][k]["pass"] for k in gating},
        "taste_layers_pass_pairwise": {k: res["pairwise_layers"].get(k, {}).get("pass") for k in TASTE},
        "look_layer_pass": res["look"]["absolute"]["pass"] and res["pairwise_layers"].get("wintercats_fidelity", {}).get("pass", False),
    }
    calibrated = [k for k in TASTE if res["absolute"][k]["pass"] and res["pairwise_layers"].get(k, {}).get("pass")]
    res["verdict"]["calibrated_layers"] = calibrated + (["wintercats_fidelity"] if res["verdict"]["look_layer_pass"] else [])
    res["verdict"]["advisory_only_layers"] = [k for k in A["layers"] if k not in res["verdict"]["calibrated_layers"]]
    res["verdict"]["panel_may_rank"] = res["absolute"]["taste"]["pass"] and bool(calibrated)
    Path(a.out).write_text(json.dumps(res, indent=1))
    print(json.dumps(res["verdict"], indent=1))
    for k, v in res["absolute"].items():
        print(f"abs {k:<18} {v['group_means']} panel_ordered={v['panel_ordered']} judges={v['judges_ordered']}")
    print("look", res["look"])
    for k, v in res["pairwise_layers"].items():
        print("pair", k, v)


if __name__ == "__main__":
    main()
