"""Aggregation over per-view scores. Pure Python, deterministic (METRICS.md §Aggregation).

Global score = per-panel median over views. Spread = interquartile range (p25..p75, linear interpolation).
TRAIN and HELD-OUT are never pooled.
"""
from __future__ import annotations

import itertools

from .manifest import PANELS

ROUND = 6


class PairingError(ValueError):
    pass


def quantile(xs, q):
    """Linear-interpolated quantile (numpy's default 'linear' method) of a non-empty list."""
    s = sorted(xs)
    if not s:
        raise ValueError("quantile of empty list")
    pos = (len(s) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def describe(xs):
    if not xs:
        return {"n": 0, "median": None, "p25": None, "p75": None, "iqr": None, "min": None, "max": None}
    p25, med, p75 = quantile(xs, .25), quantile(xs, .5), quantile(xs, .75)
    return {"n": len(xs), "median": round(med, ROUND), "p25": round(p25, ROUND), "p75": round(p75, ROUND),
            "iqr": round(p75 - p25, ROUND), "min": round(min(xs), ROUND), "max": round(max(xs), ROUND)}


def summarize(scores: dict) -> dict:
    """scores = a scores file (cli score). -> {panel: {expected, scored, metric: describe + coverage}}."""
    out = {}
    for panel in PANELS:
        views = [v for v in scores["views"] if v["panel"] == panel]
        expected = scores["expected"][panel]
        row = {"expected": expected, "scored_views": len(views),
               "not_scored": [n for n in scores["not_scored"] if n["panel"] == panel]}
        for m in scores["metrics_requested"]:
            xs = [v["metrics"][m] for v in views if v["metrics"].get(m) is not None]
            d = describe(xs)
            d["coverage"] = round(d["n"] / expected, ROUND) if expected else 0.0
            d["unavailable"] = sorted({v["unavailable"][m] for v in views if m in v["unavailable"]})
            row[m] = d
        out[panel] = row
    return out


def _by_view(scores):
    return {v["view_id"]: v for v in scores["views"]}


def paired(parent: dict, cand: dict) -> dict:
    """Per-view delta = candidate - parent (negative = candidate closer to the target). Views are matched by id and
    must share the target sha256: a different target for the same view is a pairing error, never a delta."""
    if parent["split"]["sha256"] != cand["split"]["sha256"]:
        raise PairingError("parent and candidate were scored against different split files")
    P, C = _by_view(parent), _by_view(cand)
    for vid in sorted(P.keys() & C.keys()):
        if P[vid]["target_sha256"] != C[vid]["target_sha256"]:
            raise PairingError(f"{vid}: parent and candidate scored against different targets")
    metrics = [m for m in cand["metrics_requested"] if m in parent["metrics_requested"]]
    out = {"parent": parent["build_id"], "candidate": cand["build_id"], "panels": {}, "views": {}}
    for vid in sorted(P.keys() & C.keys()):
        out["views"][vid] = {"panel": C[vid]["panel"], **{m: (None if P[vid]["metrics"].get(m) is None or C[vid]["metrics"].get(m) is None
                                                             else round(C[vid]["metrics"][m] - P[vid]["metrics"][m], ROUND)) for m in metrics}}
    for panel in PANELS:
        ids = [v for v in sorted(P.keys() | C.keys()) if (P.get(v) or C.get(v))["panel"] == panel]
        both = [v for v in ids if v in P and v in C]
        row = {"views_in_either": len(ids), "views_paired": len(both)}
        for m in metrics:
            d = [out["views"][v][m] for v in both if out["views"][v][m] is not None]
            r = describe(d)
            r.update(improved=sum(x < 0 for x in d), worse=sum(x > 0 for x in d), ties=sum(x == 0 for x in d))
            row[m] = r
        out["panels"][panel] = row
    return out


def noise_floor(runs: list) -> dict:
    """>= 3 recaptures of one unchanged build. For every run pair, the per-view deltas and the panel median delta.
    floor = max over pairs of |panel median delta|: a candidate's panel median delta must beat it to count."""
    if len(runs) < 3:
        raise ValueError(f"noise floor needs >= 3 recaptures, got {len(runs)}")
    if len({r["build_id"] for r in runs}) != 1:
        raise ValueError("noise floor runs must share one build_id (same unchanged build)")
    if len({r["run_id"] for r in runs}) != len(runs):
        raise ValueError("noise floor runs must have distinct run_ids")
    metrics = sorted(set.intersection(*(set(r["metrics_requested"]) for r in runs)))
    out = {"build_id": runs[0]["build_id"], "runs": [r["run_id"] for r in runs], "panels": {}}
    for panel in PANELS:
        row = {}
        for m in metrics:
            pair_meds, per_view = [], []
            for a, b in itertools.combinations(runs, 2):
                pr = paired(a, b)
                d = [v[m] for v in pr["views"].values() if v["panel"] == panel and v[m] is not None]
                if d:
                    pair_meds.append(quantile(d, .5)); per_view += [abs(x) for x in d]
            if not pair_meds:
                row[m] = None
                continue
            row[m] = {"pairs": len(pair_meds), "pair_median_deltas": [round(x, ROUND) for x in pair_meds],
                      "floor": round(max(abs(x) for x in pair_meds), ROUND),
                      "per_view_abs_p50": round(quantile(per_view, .5), ROUND),
                      "per_view_abs_p95": round(quantile(per_view, .95), ROUND),
                      "per_view_abs_max": round(max(per_view), ROUND)}
        out["panels"][panel] = row
    return out


def beyond_noise(pair: dict, noise: dict, metric: str = "dists", panel: str = "heldout"):
    """True if the candidate's panel median delta is an improvement larger than the noise floor. None if either
    number is missing (a missing number is never a pass)."""
    d = pair["panels"][panel].get(metric, {}).get("median")
    f = (noise["panels"][panel].get(metric) or {}).get("floor")
    if d is None or f is None:
        return None
    return d < -f
