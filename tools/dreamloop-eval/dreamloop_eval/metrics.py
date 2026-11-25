"""Per-view metrics: one capture vs THAT view's target (METRICS.md). Every metric is a distance: lower = closer.

Colour and edge metrics use numpy + OpenCV only. LPIPS and DISTS need torch (`lpips`, `piq`). If they can't be
loaded, `MetricUnavailable` is raised. A missing metric is never replaced with a guess.
"""
from __future__ import annotations

import os
import pathlib

import cv2
import numpy as np

from .manifest import CLASSES, ManifestError, Record

WORK = (384, 256)            # (w, h) scoring resolution
CLASS_MIN_FRAC = 0.005       # a class takes part in a view only if it covers >= 0.5% of the valid pixels
UNKNOWN = 255
METRICS = ("dists", "lpips", "class_de", "class_spread_de", "edge_dist")
PERCEPTUAL = ("dists", "lpips")


class MetricUnavailable(RuntimeError):
    pass


def read_rgb(path: pathlib.Path) -> np.ndarray:
    im = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if im is None:
        raise ManifestError(f"cannot decode image {path}")
    return im[..., ::-1]


def to_work(im: np.ndarray, work=WORK) -> np.ndarray:
    return cv2.resize(im, work, interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0


def load_view(rec: Record, work=WORK):
    """-> (render, target, valid, classes) at work res. render/target: float32 RGB 0..1. valid: bool (outside
    ignore_rects). classes: uint8 class index per px (UNKNOWN where ignored or unlabelled) or None."""
    cap, tgt = read_rgb(rec.capture_path), read_rgb(rec.target_path)
    ar_c, ar_t = cap.shape[1] / cap.shape[0], tgt.shape[1] / tgt.shape[0]
    if abs(ar_c / ar_t - 1) > 0.01:
        raise ManifestError(f"{rec.view_id}: target aspect {ar_t:.3f} != capture aspect {ar_c:.3f} (wrong target?)")
    x, t = to_work(cap, work), to_work(tgt, work)
    valid = np.ones(x.shape[:2], bool)
    W, H = work
    for x0, y0, x1, y1 in rec.ignore_rects:
        sl = (slice(int(round(y0 * H)), int(round(y1 * H))), slice(int(round(x0 * W)), int(round(x1 * W))))
        valid[sl] = False
        x[sl] = 0.5
        t[sl] = 0.5
    cls = None
    if rec.mask_path is not None:
        m = cv2.imread(str(rec.mask_path), cv2.IMREAD_UNCHANGED)
        if m is None or m.ndim != 2:
            raise ManifestError(f"{rec.view_id}: class mask must be a 1-channel index PNG: {rec.mask_path}")
        cls = cv2.resize(m.astype(np.uint8), work, interpolation=cv2.INTER_NEAREST)
        cls[~valid] = UNKNOWN
    return x, t, valid, cls


def lab(im: np.ndarray) -> np.ndarray:
    """sRGB 0..1 float32 -> CIELAB (D65), L 0..100."""
    return cv2.cvtColor(np.ascontiguousarray(im, np.float32), cv2.COLOR_RGB2Lab)


def class_colour(x, t, cls):
    """Per OSM class: mean-Lab dE76 and std-Lab distance, render vs target, over that class's pixels.
    -> (summary dict or None, per-class dict, unavailable reason or None)."""
    if cls is None:
        return None, {}, "no_class_mask"
    lx, lt = lab(x), lab(t)
    labelled = cls != UNKNOWN
    total = int(labelled.sum())
    per, num_de, num_sp, area = {}, 0.0, 0.0, 0
    for ci, name in enumerate(CLASSES):
        sel = cls == ci
        n = int(sel.sum())
        frac = n / total if total else 0.0
        row = {"px": n, "frac": round(frac, 6), "present": bool(total and frac >= CLASS_MIN_FRAC)}
        if row["present"]:
            px, pt = lx[sel].astype(np.float64), lt[sel].astype(np.float64)
            de = float(np.linalg.norm(px.mean(0) - pt.mean(0)))
            sp = float(np.linalg.norm(px.std(0) - pt.std(0)))
            row.update(de=de, spread_de=sp, render_lab=[round(float(v), 3) for v in px.mean(0)],
                       target_lab=[round(float(v), 3) for v in pt.mean(0)])
            num_de += de * n; num_sp += sp * n; area += n
        per[name] = row
    if not area:
        return None, per, "no_class_pixels"
    return {"class_de": num_de / area, "class_spread_de": num_sp / area}, per, None


_BINOM = np.array([1, 4, 6, 4, 1], np.float32) / 16


def edge_map(im):
    g = 0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]
    g = cv2.sepFilter2D(g.astype(np.float32), -1, _BINOM, _BINOM, borderType=cv2.BORDER_REPLICATE)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3, borderType=cv2.BORDER_REPLICATE)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3, borderType=cv2.BORDER_REPLICATE)
    return np.sqrt(gx * gx + gy * gy)


def edge_dist(x, t, valid):
    """1 - Pearson correlation of Sobel magnitudes over valid pixels. 0 = edges line up, 1 = unrelated, 2 = inverted."""
    ex, et = edge_map(x)[valid].astype(np.float64), edge_map(t)[valid].astype(np.float64)
    ex -= ex.mean(); et -= et.mean()
    den = np.sqrt((ex * ex).sum() * (et * et).sum())
    if den == 0:
        return None, "flat_image"
    return 1.0 - float((ex * et).sum() / den), None


class Perceptual:
    """LPIPS-vgg and DISTS. Loads lazily and raises MetricUnavailable instead of falling back."""

    def __init__(self, device=None):
        self.device = device or os.environ.get("DREAMLOOP_DEVICE", "cpu")
        self._nets = {}

    def _net(self, name):
        if name in self._nets:
            return self._nets[name]
        try:
            import warnings
            import torch
            warnings.filterwarnings("ignore", module="torchvision")  # lpips' deprecated `pretrained=` call
            if name == "lpips":
                import lpips
                net = lpips.LPIPS(net="vgg", verbose=False)
            else:
                import piq
                net = piq.DISTS(reduction="none")
            net = net.to(self.device).eval()
            for p in net.parameters():
                p.requires_grad_(False)
        except Exception as e:  # ImportError, missing/undownloadable weights, bad device
            raise MetricUnavailable(f"{name}: {type(e).__name__}: {e}") from e
        self._nets[name] = (torch, net)
        return self._nets[name]

    def check(self, names):
        for n in names:
            self._net(n)

    def __call__(self, name, x, t):
        torch, net = self._net(name)
        a = torch.from_numpy(np.ascontiguousarray(x)).permute(2, 0, 1)[None].to(self.device)
        b = torch.from_numpy(np.ascontiguousarray(t)).permute(2, 0, 1)[None].to(self.device)
        with torch.no_grad():
            v = net(a * 2 - 1, b * 2 - 1) if name == "lpips" else net(a, b)
        return float(v.flatten()[0])


def score_view(rec: Record, metrics=METRICS, perceptual: Perceptual | None = None, work=WORK) -> dict:
    x, t, valid, cls = load_view(rec, work)
    perceptual = perceptual or Perceptual()
    vals, unavailable = {}, {}
    for name in PERCEPTUAL:
        if name in metrics:
            vals[name] = perceptual(name, x, t)
    classes = {}
    if "class_de" in metrics or "class_spread_de" in metrics:
        summ, classes, why = class_colour(x, t, cls)
        for k in ("class_de", "class_spread_de"):
            if k in metrics:
                vals[k] = None if summ is None else summ[k]
                if why:
                    unavailable[k] = why
    if "edge_dist" in metrics:
        vals["edge_dist"], why = edge_dist(x, t, valid)
        if why:
            unavailable["edge_dist"] = why
    return {"view_id": rec.view_id, "location_id": rec.location_id, "panel": rec.panel,
            "build_id": rec.build_id, "run_id": rec.run_id, "target_version": rec.target_version,
            "target_sha256": rec.target_sha256, "capture_sha256": rec.capture_sha256,
            "metrics": vals, "unavailable": unavailable, "classes": classes}
