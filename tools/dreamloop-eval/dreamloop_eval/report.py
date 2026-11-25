"""Markdown + JSON report: TRAIN and HELD-OUT side by side, never pooled. Missing inputs are shown as missing."""
from __future__ import annotations

from . import aggregate
from .manifest import PANELS

LABEL = {"train": "TRAIN", "heldout": "HELD-OUT"}


def _f(x, nd=4):
    return "—" if x is None else f"{x:.{nd}f}"


def _sf(x, nd=4):
    return "—" if x is None else f"{x:+.{nd}f}"


def summary_table(scores) -> str:
    s = scores["summary"]
    lines = ["| metric (lower = closer) | " + " | ".join(f"{LABEL[p]} median [p25, p75] (n/expected)" for p in PANELS) + " |",
             "|---|" + "---|" * len(PANELS)]
    for m in scores["metrics_requested"]:
        cells = []
        for p in PANELS:
            d = s[p][m]
            cov = f"{d['n']}/{s[p]['expected']}"
            un = f" unavailable: {', '.join(d['unavailable'])}" if d["unavailable"] else ""
            cells.append(f"{_f(d['median'])} [{_f(d['p25'])}, {_f(d['p75'])}] ({cov}){un}")
        lines.append(f"| {m} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def render(cand, parent=None, noise=None, vis=None, judges=None, primary="dists"):
    md = [f"# Dream-loop score report: `{cand['build_id']}` run `{cand['run_id']}`", "",
          f"- Split `{cand['split']['version']}` (sha256 {cand['split']['sha256'][:12]}); work res {cand['work_res'][0]}x{cand['work_res'][1]}; "
          f"device {cand['device']}; scored {cand['time']}.",
          f"- Every view is scored only against its own target (target sha256 recorded per view). Spread = IQR (p25..p75).",
          f"- Primary metric: `{primary}` (global score = panel median). Other metrics are diagnostics.", ""]
    nots = cand["not_scored"]
    if nots:
        md.append(f"- Not scored (count against coverage): " + ", ".join(f"{n['view_id']} ({n['status']}: {n['reason']})" for n in nots))
        md.append("")
    md += ["## Scores", "", summary_table(cand), ""]
    js = {"build_id": cand["build_id"], "run_id": cand["run_id"], "primary": primary, "summary": cand["summary"], "checks": {}}
    pair = None
    if parent:
        pair = aggregate.paired(parent, cand)
        js["paired"] = pair
        md += [f"## Candidate − parent `{parent['build_id']}` run `{parent['run_id']}` (negative = candidate closer)", "",
               "| metric | " + " | ".join(f"{LABEL[p]} median Δ [p25, p75] · better/worse/tie (paired/either)" for p in PANELS) + " |",
               "|---|" + "---|" * len(PANELS)]
        for m in cand["metrics_requested"]:
            cells = []
            for p in PANELS:
                d = pair["panels"][p].get(m)
                if not d:
                    cells.append("—"); continue
                cells.append(f"{_sf(d['median'])} [{_sf(d['p25'])}, {_sf(d['p75'])}] · {d['improved']}/{d['worse']}/{d['ties']} "
                             f"({pair['panels'][p]['views_paired']}/{pair['panels'][p]['views_in_either']})")
            md.append(f"| {m} | " + " | ".join(cells) + " |")
        md.append("")
    checks = js["checks"]
    if noise:
        js["noise"] = noise
        md += [f"## Noise floor: {len(noise['runs'])} recaptures of `{noise['build_id']}`", "",
               "| panel | metric | floor = max \\|pair median Δ\\| | per-view \\|Δ\\| p50 / p95 / max |", "|---|---|---|---|"]
        for p in PANELS:
            for m, d in noise["panels"][p].items():
                if d:
                    md.append(f"| {LABEL[p]} | {m} | {_f(d['floor'])} | {_f(d['per_view_abs_p50'])} / {_f(d['per_view_abs_p95'])} / {_f(d['per_view_abs_max'])} |")
        md.append("")
    if pair is not None:
        checks["heldout_beyond_noise"] = aggregate.beyond_noise(pair, noise, primary, "heldout") if noise else None
        checks["train_no_regression"] = (lambda d: None if d is None else d <= 0)(pair["panels"]["train"].get(primary, {}).get("median"))
    if vis:
        js["visible_change"] = vis
        md += [f"## Visible change vs parent (blurred dE76 > {vis['tol_dE76']}, sigma {vis['blur_sigma_px']} px)", "",
               " · ".join(f"{LABEL[p]} median {_f(vis['panels'][p]['median'], 3)} [{_f(vis['panels'][p]['p25'], 3)}, {_f(vis['panels'][p]['p75'], 3)}] (n {vis['panels'][p]['n']})" for p in PANELS),
               "", f"**{vis['verdict']}**", ""]
        checks["visible"] = not vis["invisible"]
    else:
        checks["visible"] = None
    if judges:
        js["judges"] = judges
        g = judges["gate"]
        md += ["## Blind two-seat A/B", "",
               f"Candidate {judges['candidate_seats']}/{judges['seats']} seats; both seats candidate {judges['candidate_both']}, "
               f"both seats parent {judges['parent_both']}, split {judges['disagree']}; ties {judges['tie_seats']}, missing {judges['missing_seats']}.",
               f"Gate: {'pass' if g['pass'] else 'FAIL: ' + '; '.join(g['reasons'])}", ""]
        checks["judges"] = g["pass"]
    else:
        checks["judges"] = None
    if missing := sorted({m for p in PANELS for m in cand["metrics_requested"] if cand["summary"][p][m]["unavailable"]}):
        checks["metrics_complete"] = False
        md.append(f"Metrics with unavailable views: {', '.join(missing)}.")
    else:
        checks["metrics_complete"] = True
    md += ["## Checks (a missing check is not a pass)", "",
           " · ".join(f"{k}: {'MISSING' if v is None else ('pass' if v else 'FAIL')}" for k, v in checks.items()), ""]
    md += ["## Per view", "", "| view | panel | " + " | ".join(cand["metrics_requested"]) + (f" | Δ{primary}" if pair else "") + (" | vis" if vis else "") + " |",
           "|---|---|" + "---|" * (len(cand["metrics_requested"]) + bool(pair) + bool(vis))]
    for v in sorted(cand["views"], key=lambda v: (v["panel"] != "heldout", v["view_id"])):
        row = [v["view_id"], LABEL[v["panel"]]] + [_f(v["metrics"].get(m)) for m in cand["metrics_requested"]]
        if pair:
            row.append(_sf((pair["views"].get(v["view_id"]) or {}).get(primary)))
        if vis:
            row.append(_f((vis["views"].get(v["view_id"]) or {}).get("share"), 3))
        md.append("| " + " | ".join(row) + " |")
    return "\n".join(md) + "\n", js
