"""Parent vs candidate visible pixel change (METRICS.md §Visible change).

A pixel counts as changed if the CIELAB dE76 between the two captures, after a Gaussian blur (sigma 1.5 px at
capture resolution, which removes single-pixel shimmer), exceeds TOL_DE. The round is INVISIBLE if the panel median
share is below INVISIBLE_SHARE on every panel. An invisible round can't be a win: change the approach.
"""
from __future__ import annotations

import cv2
import numpy as np

from . import aggregate
from .manifest import PANELS, ManifestError
from .metrics import lab, read_rgb

TOL_DE = 5.0
BLUR_SIGMA = 1.5
INVISIBLE_SHARE = 0.05


def changed_share(a_path, b_path, tol=TOL_DE, sigma=BLUR_SIGMA) -> float:
    a, b = read_rgb(a_path), read_rgb(b_path)
    if a.shape != b.shape:
        raise ManifestError(f"visible change needs equal sizes: {a.shape} vs {b.shape}")
    la = lab(cv2.GaussianBlur(a.astype(np.float32) / 255, (0, 0), sigma))
    lb = lab(cv2.GaussianBlur(b.astype(np.float32) / 255, (0, 0), sigma))
    return float((np.sqrt(((la - lb) ** 2).sum(-1)) > tol).mean())


def visible_change(manifest, parent, cand, tol=TOL_DE, sigma=BLUR_SIGMA) -> dict:
    """parent/cand = (build_id, run_id or None). Pairs score-mode captures by view id (and the same camera)."""
    parent, cand = manifest.resolve(*parent), manifest.resolve(*cand)
    P = {r.view_id: r for r in manifest.scorable(*parent)}
    C = {r.view_id: r for r in manifest.scorable(*cand)}
    if not P or not C:
        raise ManifestError(f"no complete score captures for {parent if not P else cand}")
    views = {}
    for vid in sorted(P.keys() & C.keys()):
        if P[vid].camera != C[vid].camera:
            raise ManifestError(f"{vid}: parent and candidate cameras differ")
        views[vid] = {"panel": C[vid].panel, "share": round(changed_share(P[vid].capture_path, C[vid].capture_path, tol, sigma), 6)}
    panels = {}
    for panel in PANELS:
        xs = [v["share"] for v in views.values() if v["panel"] == panel]
        panels[panel] = aggregate.describe(xs)
    meds = [panels[p]["median"] for p in PANELS if panels[p]["median"] is not None]
    invisible = bool(meds) and all(m < INVISIBLE_SHARE for m in meds)
    return {"schema": "gev-dreamloop/change-1", "parent": list(parent), "candidate": list(cand),
            "tol_dE76": tol, "blur_sigma_px": sigma, "invisible_below": INVISIBLE_SHARE,
            "panels": panels, "views": views, "invisible": invisible,
            "verdict": ("INVISIBLE: median visible change < 5% on every panel. Not a win; change the approach."
                        if invisible else "visible")}
