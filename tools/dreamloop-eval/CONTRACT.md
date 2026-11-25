# Capture manifest contract (`gev-dreamloop/capture-1`)

This contract sits between the capture worker (writes manifests) and the scorer (reads them).
Either side can change independently as long as the records below stay valid.
`dreamloop_eval.manifest.load_manifest` is the reference validator. A manifest that fails it is
rejected as a whole: the scorer never scores part of a bad manifest.

## Split file (`gev-dreamloop/split-1`)

```json
{
  "schema": "gev-dreamloop/split-1",
  "version": "gevg-prereg-2026-11-24",
  "source": "gevg/views_open.py TEST set, fixed before capture",
  "panels": {"train": ["H0", "H1", "H2", "H4", "H5", "H6", "H7", "H9"], "heldout": ["H3", "H8"]}
}
```

- Panels hold location ids, not view ids. Every view of a location sits in that location's panel.
- A location listed in both panels is rejected (panel leakage).
- The legacy `apploop/split.json` shape (`train_ids` / `heldout_ids`) is also read.

## Manifest: JSON Lines, one record per (build, run, view, render mode)

```json
{
  "schema": "gev-dreamloop/capture-1",
  "build_id": "wintercats@1eaa7a8c7+volgwT",
  "commit": "1eaa7a8c7",
  "run_id": "r08-1795577098",
  "panel": "heldout",
  "location_id": "H3",
  "view_id": "H3-V0",
  "camera": {"lat": 60.16, "lon": 24.95, "agl_m": 350, "pitch": -50, "heading": 0, "time": "2026-06-21T12:30:00Z"},
  "width": 1536,
  "height": 1024,
  "render_mode": "score",
  "target": {
    "view_id": "H3-V0", "version": "gevg-r4o", "path": "/abs/target.png", "sha256": "…",
    "camera": null, "ignore_rects": [[0, 0, 0.3125, 0.09375]]
  },
  "class_mask": {"view_id": "H3-V0", "path": "/abs/H3-V0.classes.png", "sha256": "…",
                 "classes": ["water", "veg", "building", "road", "other"]},
  "capture": {"path": "/abs/H3-V0.png", "sha256": "…"},
  "status": "complete",
  "reason": null
}
```

| Field | Rule the scorer enforces |
|---|---|
| `build_id` | Names what was rendered: commit plus preset/arm. Recaptures of an unchanged build share it. |
| `run_id` | One capture pass. Recaptures differ only in `run_id`. `(build_id, run_id, view_id, render_mode)` is unique. |
| `panel`, `location_id` | `panel` must equal the split file's panel for `location_id`. |
| `view_id` | Must start with `location_id + "-"` (`H3-V0`, `L03-S02-V05`). |
| `width`, `height` | Must equal the capture PNG's size. |
| `render_mode` | `score`, `look` or `clear`. Only `score` records are scored. `look`/`clear` are evidence renders. |
| `target.view_id` | Must equal `view_id`. One target file (by sha256) may serve only one view id in a manifest. |
| `target.sha256` | Must match the file bytes. A candidate and its parent must use the same target sha per view. |
| `target.camera` | Optional. When present it must equal `camera`. |
| `target.ignore_rects` | Optional `[x0, y0, x1, y1]` in 0..1 image fractions, blanked in both images (e.g. sheet labels). |
| `class_mask` | Optional. A single-channel PNG of class indices for this view (`255` = unknown). `view_id` must match. If it is absent, class colour metrics are `unavailable` for the view. They are never estimated. |
| `capture.sha256` | Must match the file bytes. |
| `status` | `complete` is scored. `incomplete` and `excluded` (with a `reason`) count against coverage and are never scored. |

Paths are absolute, or relative to the manifest file's directory.
