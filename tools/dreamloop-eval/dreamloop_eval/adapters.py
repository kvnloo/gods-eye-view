"""Bridge for renders that predate the capture-1 contract: gev-factory/apploop (GEV-G open Helsinki views).

Writes capture-1 records for one apploop <tag>/<arm>. Class masks are decoded from each view's OSM debug overlay
with GEV-G's own decoder (gevg.class_mask), so both harnesses use the same class map. Set GEVG_DIR to the gevg folder.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

import cv2

from .manifest import CAPTURE_SCHEMA, load_split, sha256

LABEL_RECT = [0.0, 0.0, 120 / 384, 24 / 256]  # contact-sheet label box on the train targets; blanked on every view


def _latest_status(render_dir: pathlib.Path, arm: str) -> dict:
    st = {}
    for f in sorted(render_dir.glob("render-*.jsonl")):
        for line in f.read_text().splitlines():
            if line.startswith("{"):
                r = json.loads(line)
                if r.get("arm") == arm:
                    st[r["id"]] = r
    return st


def apploop_manifest(apploop, tag_arm, build_id, run_id, commit, out, masks) -> int:
    apploop, masks = pathlib.Path(apploop), pathlib.Path(masks)
    sys.path.insert(0, os.environ.get("GEVG_DIR", str(apploop.parent / "gevg")))
    import gevg
    gevg.BULK = apploop / "targets"
    split = load_split(apploop / "split.json")
    tag, arm = tag_arm.split("/")
    status = _latest_status(apploop / "renders" / tag, arm)
    masks.mkdir(parents=True, exist_ok=True)
    recs = []
    for v in json.loads((apploop / "views_cache.json").read_text())["views"]:
        vid, loc = v["id"], v["id"].split("-")[0]
        cap = apploop / "renders" / tag / arm / f"{vid}.png"
        tgt = apploop / "targets" / vid / "target.png"
        mp = masks / f"{vid}.classes.png"
        if not mp.exists():
            cv2.imwrite(str(mp), gevg.class_mask(vid).astype("uint8"))
        log = status.get(vid)
        if not cap.exists():
            st, why = "incomplete", "no render file"
        elif log is None:
            st, why = "incomplete", "no render log line"
        elif log.get("errs") or not log.get("tiles"):
            st, why = "incomplete", f"tiles={log.get('tiles')} errs={log.get('errs')}"
        else:
            st, why = "complete", None
        im = cv2.imread(str(cap)) if cap.exists() else None
        recs.append({
            "schema": CAPTURE_SCHEMA, "build_id": build_id, "commit": commit, "run_id": run_id,
            "panel": split.panel_of[loc], "location_id": loc, "view_id": vid,
            "camera": {k: v.get(k) for k in ("lat", "lon", "agl_m", "pitch", "heading", "time", "ground_m")},
            "width": 1536 if im is None else im.shape[1], "height": 1024 if im is None else im.shape[0],
            "render_mode": "score",
            "target": {"view_id": vid, "version": "gevg-r4o-local-mirror", "path": str(tgt), "sha256": sha256(tgt),
                       "camera": None, "ignore_rects": [LABEL_RECT]},
            "class_mask": {"view_id": vid, "path": str(mp), "sha256": sha256(mp), "classes": list(gevg.CLASSES)},
            "capture": {"path": str(cap), "sha256": sha256(cap) if cap.exists() else None},
            "status": st, "reason": why})
    with open(out, "a") as fh:
        for r in recs:
            fh.write(json.dumps(r) + "\n")
    return len(recs)
