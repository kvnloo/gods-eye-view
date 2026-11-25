"""Synthetic, deterministic fixtures: tiny PNG captures/targets/masks and capture-1 manifests in a temp dir."""
import json
import pathlib
import tempfile

import cv2
import numpy as np

from dreamloop_eval.manifest import CAPTURE_SCHEMA, SPLIT_SCHEMA, sha256

W, H = 96, 64
SPLIT = {"schema": SPLIT_SCHEMA, "version": "test-1", "source": "fixture",
         "panels": {"train": ["A0", "A1"], "heldout": ["B0"]}}
VIEWS = [("A0", "A0-V0"), ("A0", "A0-V1"), ("A1", "A1-V0"), ("B0", "B0-V0"), ("B0", "B0-V1")]


def vseed(vid):
    """Stable per-view seed (str hash() is salted per process)."""
    return int.from_bytes(vid.encode(), "big") % 1000


def image(seed, shift=0.0):
    """Smooth deterministic RGB uint8 image (gradients + discs) keyed by seed."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rng = np.random.default_rng(seed)
    im = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        a, b, p = rng.uniform(0.02, 0.2, 3)
        im[..., c] = 0.5 + 0.35 * np.sin(a * xx + b * yy + p * 6)
    for _ in range(3):
        cx, cy, r = rng.uniform(10, W - 10), rng.uniform(10, H - 10), rng.uniform(5, 14)
        im[(xx - cx) ** 2 + (yy - cy) ** 2 < r * r] = rng.uniform(0, 1, 3)
    return np.clip((im + shift) * 255, 0, 255).astype(np.uint8)


def mask():
    m = np.full((H, W), 4, np.uint8)
    m[:, :30] = 1          # veg
    m[:20, 40:80] = 2      # building
    m[50:, :] = 3          # road
    m[0, 0] = 0            # 1 px of water: below CLASS_MIN_FRAC, must be "absent"
    return m


class Fixture:
    def __init__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        (self.dir / "split.json").write_text(json.dumps(SPLIT))
        self.split_path = self.dir / "split.json"
        for _, vid in VIEWS:
            self.png(f"targets/{vid}.png", image(vseed(vid)))
            self.png(f"masks/{vid}.png", mask())

    def png(self, rel, arr):
        p = self.dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(p), arr if arr.ndim == 2 else arr[..., ::-1])
        return p

    def capture(self, build, run, vid, arr):
        return self.png(f"caps/{build}/{run}/{vid}.png", arr)

    def record(self, build, run, loc, vid, cap, panel=None, **over):
        tgt, msk = self.dir / f"targets/{vid}.png", self.dir / f"masks/{vid}.png"
        panel = panel or ("heldout" if loc.startswith("B") else "train")
        r = {"schema": CAPTURE_SCHEMA, "build_id": build, "commit": "abc1234", "run_id": run, "panel": panel,
             "location_id": loc, "view_id": vid, "camera": {"view": vid}, "width": W, "height": H,
             "render_mode": "score",
             "target": {"view_id": vid, "version": "t1", "path": str(tgt), "sha256": sha256(tgt), "camera": None,
                        "ignore_rects": []},
             "class_mask": {"view_id": vid, "path": str(msk), "sha256": sha256(msk),
                            "classes": ["water", "veg", "building", "road", "other"]},
             "capture": {"path": str(cap), "sha256": sha256(cap)}, "status": "complete", "reason": None}
        for k, v in over.items():
            r[k] = v
        return r

    def build(self, build, run, shift=0.0, seed_off=0, views=VIEWS):
        """Capture = the view's own target + optional brightness shift (seed_off != 0 = a different image)."""
        recs = []
        for loc, vid in views:
            base = image(vseed(vid) + seed_off, shift)
            recs.append(self.record(build, run, loc, vid, self.capture(build, run, vid, base)))
        return recs

    def manifest(self, recs, name="manifest.jsonl"):
        p = self.dir / name
        p.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
        return p

    def close(self):
        self.tmp.cleanup()
