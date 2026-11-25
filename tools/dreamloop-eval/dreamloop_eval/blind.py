"""Identity-blinded two-seat A/B judging packets (METRICS.md §Blind A/B).

Layout under <out>/:
  packet/seat1/, packet/seat2/   what a judge sees: neutral item ids, X.png / Y.png / target.png, items.json
  sealed/unblind.json            seed, sample, which side is the candidate per item and seat (never shown to judges)
  verdicts/seat1.jsonl, seat2.jsonl   judge verdicts by item id only (no identity)
  result.json                    written by `tally`: verdicts joined with the unblinding key
Seat 2 shows every sampled view with the sides swapped relative to seat 1. The side order per view, the sample and
the item ids all come from one seeded RNG, so the same seed and inputs give the same packet.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import random

import cv2

from .manifest import PANELS, ManifestError
from .metrics import read_rgb

SEATS = ("seat1", "seat2")
WINNERS = ("X", "Y", "tie")
PACKET_SCHEMA = "gev-dreamloop/ab-packet-1"
INSTRUCTIONS = ("Each item has a target image and two renders, X and Y, of the same view. Pick the render whose look "
                "is closer to the target (palette, light, materials, volume). Answer X, Y or tie.\n"
                "Write one JSON line per item: {\"item\": \"<id>\", \"winner\": \"X|Y|tie\", \"judge\": \"<name>\"}\n")


class LeakageError(RuntimeError):
    pass


def _rng(seed: str, ids) -> random.Random:
    h = hashlib.sha256((seed + "|" + ",".join(sorted(ids))).encode()).hexdigest()
    return random.Random(int(h, 16))


def _write_png(src, dst: pathlib.Path):
    """Re-encode pixels only: cv2 writes no text/time chunks, so no source path or tool metadata rides along."""
    ok, buf = cv2.imencode(".png", read_rgb(src)[..., ::-1])
    if not ok:
        raise ManifestError(f"cannot encode {src}")
    dst.write_bytes(buf.tobytes())


def make_packets(manifest, parent, cand, seed: str, k: dict, out) -> dict:
    out = pathlib.Path(out)
    if out.exists() and any(out.iterdir()):
        raise ManifestError(f"{out} is not empty; packets are write-once")
    parent, cand = manifest.resolve(*parent), manifest.resolve(*cand)
    P = {r.view_id: r for r in manifest.scorable(*parent)}
    C = {r.view_id: r for r in manifest.scorable(*cand)}
    if parent[0] == cand[0]:
        raise ManifestError("parent and candidate are the same build")
    eligible = sorted(v for v in P.keys() & C.keys() if P[v].target_sha256 == C[v].target_sha256)
    rng = _rng(seed, eligible)
    sample, shortfall = [], {}
    for panel in PANELS:
        pool = [v for v in eligible if C[v].panel == panel]
        want = k.get(panel, 0)
        if want > len(pool):
            shortfall[panel] = {"wanted": want, "available": len(pool)}
        sample += sorted(rng.sample(pool, min(want, len(pool))))
    if not sample:
        raise ManifestError("no eligible views to judge")
    x_is_cand = {v: rng.random() < 0.5 for v in sample}
    sealed = {"schema": PACKET_SCHEMA, "seed": seed, "parent": list(parent), "candidate": list(cand),
              "eligible": eligible, "k": k, "shortfall": shortfall, "items": {}}
    seat_items = {}
    for si, seat in enumerate(SEATS):
        order = sample[:]
        rng.shuffle(order)
        seat_items[seat] = []
        for vid in order:
            item = f"i{rng.getrandbits(48):012x}"
            cand_side = "X" if x_is_cand[vid] == (si == 0) else "Y"  # seat 2 swaps sides
            sealed["items"][item] = {"seat": seat, "view_id": vid, "panel": C[vid].panel, "candidate_is": cand_side,
                                     "target_sha256": C[vid].target_sha256,
                                     "parent_capture_sha256": P[vid].capture_sha256, "candidate_capture_sha256": C[vid].capture_sha256}
            seat_items[seat].append((item, vid, cand_side))
    for seat, items in seat_items.items():
        sd = out / "packet" / seat
        listing = []
        for item, vid, cand_side in items:
            d = sd / item
            d.mkdir(parents=True)
            x, y = (C[vid], P[vid]) if cand_side == "X" else (P[vid], C[vid])
            _write_png(x.capture_path, d / "X.png")
            _write_png(y.capture_path, d / "Y.png")
            _write_png(C[vid].target_path, d / "target.png")
            listing.append({"item": item, "target": f"{item}/target.png", "X": f"{item}/X.png", "Y": f"{item}/Y.png"})
        (sd / "items.json").write_text(json.dumps({"schema": PACKET_SCHEMA, "seat": seat, "items": listing}, indent=1))
        (sd / "INSTRUCTIONS.txt").write_text(INSTRUCTIONS)
    (out / "sealed").mkdir()
    (out / "sealed" / "unblind.json").write_text(json.dumps(sealed, indent=1))
    (out / "verdicts").mkdir()
    audit_packet(out)
    return sealed


def _identity_tokens(sealed: dict) -> set:
    toks = set(sealed["parent"]) | set(sealed["candidate"]) | {"parent", "candidate"}
    if len(sealed["seed"]) >= 8:  # the seed rebuilds the key; short seeds would false-positive on any text
        toks.add(sealed["seed"])
    for it in sealed["items"].values():
        toks |= {it["view_id"], it["parent_capture_sha256"], it["candidate_capture_sha256"], it["target_sha256"]}
    return {t for t in toks if t}


def _png_chunks(data: bytes):
    i, out = 8, []
    while i + 8 <= len(data):
        n = int.from_bytes(data[i:i + 4], "big")
        out.append(data[i + 4:i + 8].decode("latin1"))
        i += 12 + n
    return out


def audit_packet(out) -> None:
    """Raise LeakageError if a judge-visible file could reveal which build is which (or which view/panel)."""
    out = pathlib.Path(out)
    sealed = json.loads((out / "sealed" / "unblind.json").read_text())
    toks = _identity_tokens(sealed)
    pk = out / "packet"
    for f in sorted(pk.rglob("*")):
        if f.is_dir():
            continue
        rel = str(f.relative_to(pk))
        if any(t in rel for t in toks):
            raise LeakageError(f"identity token in judge-visible path {rel}")
        data = f.read_bytes()
        if f.suffix == ".png":
            extra = [c for c in _png_chunks(data) if c not in ("IHDR", "IDAT", "IEND", "PLTE")]
            if extra:
                raise LeakageError(f"{rel}: metadata chunks {extra}")
        else:
            text = data.decode("utf8", "replace")
            hit = sorted(t for t in toks if t in text)
            if hit:
                raise LeakageError(f"{rel}: identity tokens {hit}")
    for name in ("unblind.json",):
        if list(pk.rglob(name)):
            raise LeakageError("unblinding key inside the judge packet")


def record_verdict(out, seat: str, item: str, winner: str, judge: str) -> dict:
    out = pathlib.Path(out)
    listing = json.loads((out / "packet" / seat / "items.json").read_text())
    if item not in {i["item"] for i in listing["items"]}:
        raise ManifestError(f"{item} is not an item of {seat}")
    if winner not in WINNERS:
        raise ManifestError(f"winner must be one of {WINNERS}")
    rec = {"item": item, "seat": seat, "winner": winner, "judge": judge}
    with open(out / "verdicts" / f"{seat}.jsonl", "a") as fh:
        fh.write(json.dumps(rec) + "\n")
    return rec


def tally(out, min_seat_share=0.6, max_both_lost=2) -> dict:
    """Join verdicts with the key. Missing verdicts, ties and errors are reported and block the gate."""
    out = pathlib.Path(out)
    sealed = json.loads((out / "sealed" / "unblind.json").read_text())
    verdicts = {}
    for seat in SEATS:
        f = out / "verdicts" / f"{seat}.jsonl"
        for line in (f.read_text().splitlines() if f.exists() else []):
            if line.strip():
                v = json.loads(line)
                if v["item"] in verdicts:
                    raise ManifestError(f"two verdicts for {v['item']}")
                verdicts[v["item"]] = v
    views = {}
    for item, it in sealed["items"].items():
        v = verdicts.get(item)
        if v is None:
            res = "missing"
        elif v["winner"] == "tie":
            res = "tie"
        else:
            res = "candidate" if v["winner"] == it["candidate_is"] else "parent"
        views.setdefault(it["view_id"], {"panel": it["panel"]})[it["seat"]] = res
    stats = {"candidate_seats": 0, "parent_seats": 0, "tie_seats": 0, "missing_seats": 0,
             "candidate_both": 0, "parent_both": 0, "disagree": 0}
    for row in views.values():
        r = [row[s] for s in SEATS]
        for x in r:
            stats[f"{x}_seats"] += 1
        if r == ["candidate"] * 2:
            stats["candidate_both"] += 1
        elif r == ["parent"] * 2:
            stats["parent_both"] += 1
        else:
            stats["disagree"] += 1
    seats = 2 * len(views)
    reasons = []
    if stats["missing_seats"]:
        reasons.append(f"{stats['missing_seats']} missing verdicts")
    if stats["candidate_seats"] < min_seat_share * seats:
        reasons.append(f"candidate won {stats['candidate_seats']}/{seats} seats (< {min_seat_share:.0%})")
    if stats["parent_both"] > max_both_lost:
        reasons.append(f"parent won both seats on {stats['parent_both']} views (> {max_both_lost})")
    result = {"schema": "gev-dreamloop/ab-result-1", "parent": sealed["parent"], "candidate": sealed["candidate"],
              "seats": seats, **stats, "gate": {"min_seat_share": min_seat_share, "max_both_lost": max_both_lost,
                                                "pass": not reasons, "reasons": reasons}, "views": views}
    (out / "result.json").write_text(json.dumps(result, indent=1))
    return result
