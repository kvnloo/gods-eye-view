"""dreamloop-eval commands. Run from tools/dreamloop-eval: `python -m dreamloop_eval <cmd> -h`."""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import sys

from . import aggregate, blind, change, metrics, report
from .manifest import PANELS, ManifestError, load_manifest, load_split, sha256


def _now():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def _build_run(s):
    b, _, r = s.partition(":")
    return b, (r or None)


def _manifest(a):
    return load_manifest(a.manifest, load_split(a.split))


def _write(path, obj):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1))
    return path


def cmd_score(a):
    m = _manifest(a)
    build, run = m.resolve(*_build_run(a.build))
    wanted = tuple(a.metrics.split(","))
    bad = [x for x in wanted if x not in metrics.METRICS]
    if bad:
        raise SystemExit(f"unknown metrics {bad}; known: {metrics.METRICS}")
    recs = m.scorable(build, run)
    expected = m.expected(build, run)
    if not expected:
        raise SystemExit(f"no score-mode records for {build}:{run}")
    perceptual = metrics.Perceptual()
    need = [x for x in wanted if x in metrics.PERCEPTUAL]
    try:
        perceptual.check(need)
    except metrics.MetricUnavailable as e:
        raise SystemExit(f"METRIC UNAVAILABLE, nothing scored: {e}")
    w, h = (int(v) for v in a.work.split("x"))
    views = [metrics.score_view(r, wanted, perceptual, (w, h)) for r in recs]
    out = {"schema": "gev-dreamloop/scores-1", "time": _now(), "build_id": build, "run_id": run,
           "manifest": {"path": m.path, "sha256": sha256(m.path)},
           "split": {"version": m.split.version, "path": m.split.path, "sha256": m.split.sha256},
           "work_res": [w, h], "metrics_requested": list(wanted), "device": perceptual.device,
           "expected": {p: sum(r.panel == p for r in expected) for p in PANELS},
           "not_scored": [{"view_id": r.view_id, "panel": r.panel, "status": r.status, "reason": r.reason}
                          for r in expected if not r.scorable],
           "views": views}
    out["summary"] = aggregate.summarize(out)
    print(_write(a.out, out))
    print(report.summary_table(out))


def _load(p):
    return json.loads(pathlib.Path(p).read_text())


def cmd_noise(a):
    out = aggregate.noise_floor([_load(p) for p in a.scores])
    print(_write(a.out, out))
    print(json.dumps(out["panels"], indent=1))


def cmd_change(a):
    m = _manifest(a)
    out = change.visible_change(m, _build_run(a.parent), _build_run(a.candidate), a.tol, a.sigma)
    print(_write(a.out, out))
    print(json.dumps({p: out["panels"][p] for p in PANELS}), out["verdict"])


def cmd_report(a):
    cand = _load(a.scores)
    parent = _load(a.parent) if a.parent else None
    noise = _load(a.noise) if a.noise else None
    vis = _load(a.change) if a.change else None
    judges = _load(a.judges) if a.judges else None
    md, js = report.render(cand, parent, noise, vis, judges, primary=a.primary)
    pathlib.Path(a.out).write_text(md)
    _write(pathlib.Path(a.out).with_suffix(".json"), js)
    print(md)


def cmd_packets(a):
    m = _manifest(a)
    k = {"heldout": a.heldout_k, "train": a.train_k}
    sealed = blind.make_packets(m, _build_run(a.parent), _build_run(a.candidate), a.seed, k, a.out)
    print(json.dumps({"out": a.out, "views": len({i["view_id"] for i in sealed["items"].values()}),
                      "items": len(sealed["items"]), "shortfall": sealed["shortfall"]}))


def cmd_verdict(a):
    print(json.dumps(blind.record_verdict(a.packet, a.seat, a.item, a.winner, a.judge)))


def cmd_tally(a):
    r = blind.tally(a.packet, a.min_seat_share, a.max_both_lost)
    print(json.dumps({k: v for k, v in r.items() if k != "views"}, indent=1))


def cmd_import_apploop(a):
    from . import adapters
    n = adapters.apploop_manifest(a.apploop, a.tag_arm, a.build_id, a.run_id, a.commit, a.out, a.masks)
    print(json.dumps({"out": a.out, "records": n}))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="dreamloop_eval")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def mf(p):
        p.add_argument("--manifest", required=True)
        p.add_argument("--split", required=True)

    p = sub.add_parser("score", help="score one build:run, every view vs its own target")
    mf(p)
    p.add_argument("--build", required=True, help="build_id or build_id:run_id")
    p.add_argument("--metrics", default=",".join(metrics.METRICS))
    p.add_argument("--work", default="384x256")
    p.add_argument("--out", required=True)
    p.set_defaults(f=cmd_score)

    p = sub.add_parser("noise", help="noise floor from >= 3 recaptures of one unchanged build")
    p.add_argument("--scores", nargs="+", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(f=cmd_noise)

    p = sub.add_parser("change", help="parent vs candidate visible pixel change")
    mf(p)
    p.add_argument("--parent", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--tol", type=float, default=change.TOL_DE)
    p.add_argument("--sigma", type=float, default=change.BLUR_SIGMA)
    p.add_argument("--out", required=True)
    p.set_defaults(f=cmd_change)

    p = sub.add_parser("report", help="TRAIN / HELD-OUT report (markdown + json)")
    p.add_argument("--scores", required=True, help="candidate scores")
    p.add_argument("--parent", help="parent scores")
    p.add_argument("--noise")
    p.add_argument("--change")
    p.add_argument("--judges", help="tally result.json")
    p.add_argument("--primary", default="dists")
    p.add_argument("--out", required=True)
    p.set_defaults(f=cmd_report)

    p = sub.add_parser("packets", help="blinded two-seat A/B packets, candidate vs parent")
    mf(p)
    p.add_argument("--parent", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--seed", required=True)
    p.add_argument("--heldout-k", type=int, default=6)
    p.add_argument("--train-k", type=int, default=4)
    p.add_argument("--out", required=True)
    p.set_defaults(f=cmd_packets)

    p = sub.add_parser("verdict", help="append one judge verdict (by item id)")
    p.add_argument("--packet", required=True)
    p.add_argument("--seat", required=True, choices=blind.SEATS)
    p.add_argument("--item", required=True)
    p.add_argument("--winner", required=True, choices=blind.WINNERS)
    p.add_argument("--judge", required=True)
    p.set_defaults(f=cmd_verdict)

    p = sub.add_parser("tally", help="unblind verdicts and apply the judge gate")
    p.add_argument("--packet", required=True)
    p.add_argument("--min-seat-share", type=float, default=0.6)
    p.add_argument("--max-both-lost", type=int, default=2)
    p.set_defaults(f=cmd_tally)

    p = sub.add_parser("import-apploop", help="write a capture-1 manifest for existing apploop renders")
    p.add_argument("--apploop", required=True)
    p.add_argument("--tag-arm", required=True, help="e.g. r08/volgwT")
    p.add_argument("--build-id", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--commit", required=True)
    p.add_argument("--masks", required=True, help="dir for decoded class-index masks")
    p.add_argument("--out", required=True, help="manifest .jsonl (appended)")
    p.set_defaults(f=cmd_import_apploop)

    a = ap.parse_args(argv)
    try:
        a.f(a)
    except (ManifestError, aggregate.PairingError, blind.LeakageError, ValueError) as e:
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    return 0
