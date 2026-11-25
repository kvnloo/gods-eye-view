"""Capture manifest + split file: parse and validate at the boundary (CONTRACT.md).

Everything past `load_manifest` can assume: each record's target and class mask belong to its own view, its panel
matches the split, and file hashes match. A bad manifest raises `ManifestError`; nothing in it is scored.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
from dataclasses import dataclass, field

CAPTURE_SCHEMA = "gev-dreamloop/capture-1"
SPLIT_SCHEMA = "gev-dreamloop/split-1"
PANELS = ("train", "heldout")
RENDER_MODES = ("score", "look", "clear")
STATUSES = ("complete", "incomplete", "excluded")
CLASSES = ("water", "veg", "building", "road", "other")


class ManifestError(ValueError):
    pass


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


@dataclass(frozen=True)
class Split:
    version: str
    panel_of: dict  # location_id -> "train" | "heldout"
    path: str
    sha256: str

    def locations(self, panel: str) -> list[str]:
        return sorted(loc for loc, p in self.panel_of.items() if p == panel)


def load_split(path) -> Split:
    path = pathlib.Path(path)
    raw = json.loads(path.read_text())
    if raw.get("schema") == SPLIT_SCHEMA:
        panels, version = raw["panels"], raw.get("version")
    elif "train_ids" in raw and "heldout_ids" in raw:  # legacy apploop/split.json
        panels, version = {"train": raw["train_ids"], "heldout": raw["heldout_ids"]}, raw.get("fixed")
    else:
        raise ManifestError(f"{path}: not a {SPLIT_SCHEMA} split file")
    if not version:
        raise ManifestError(f"{path}: split has no version")
    if set(panels) != set(PANELS):
        raise ManifestError(f"{path}: panels must be exactly {PANELS}, got {sorted(panels)}")
    both = set(panels["train"]) & set(panels["heldout"])
    if both:
        raise ManifestError(f"{path}: panel leakage, locations in both panels: {sorted(both)}")
    if not panels["heldout"] or not panels["train"]:
        raise ManifestError(f"{path}: both panels need at least one location")
    panel_of = {loc: p for p in PANELS for loc in panels[p]}
    return Split(version=str(version), panel_of=panel_of, path=str(path), sha256=sha256(path))


@dataclass(frozen=True)
class Record:
    build_id: str
    commit: str
    run_id: str
    panel: str
    location_id: str
    view_id: str
    camera: dict
    width: int
    height: int
    render_mode: str
    target_path: pathlib.Path
    target_sha256: str
    target_version: str
    ignore_rects: tuple
    mask_path: pathlib.Path | None
    capture_path: pathlib.Path | None  # None only when status != complete
    capture_sha256: str | None
    status: str
    reason: str | None
    raw: dict = field(repr=False, compare=False, default_factory=dict)

    @property
    def scorable(self) -> bool:
        return self.status == "complete" and self.render_mode == "score"


def _req(rec: dict, key: str, where: str):
    if key not in rec or rec[key] is None:
        raise ManifestError(f"{where}: missing {key!r}")
    return rec[key]


def _path(base: pathlib.Path, p: str) -> pathlib.Path:
    q = pathlib.Path(p)
    return q if q.is_absolute() else base / q


def _png_size(path: pathlib.Path) -> tuple[int, int]:
    head = path.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ManifestError(f"{path}: capture is not a PNG")
    return int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")


def parse_record(rec: dict, split: Split, base: pathlib.Path, where: str, check_files: bool = True) -> Record:
    if rec.get("schema") != CAPTURE_SCHEMA:
        raise ManifestError(f"{where}: schema must be {CAPTURE_SCHEMA!r}, got {rec.get('schema')!r}")
    view_id, loc = _req(rec, "view_id", where), _req(rec, "location_id", where)
    where = f"{where} [{view_id}]"
    if not view_id.startswith(loc + "-"):
        raise ManifestError(f"{where}: view_id does not belong to location {loc!r}")
    panel = _req(rec, "panel", where)
    if panel not in PANELS:
        raise ManifestError(f"{where}: unknown panel {panel!r}")
    if loc not in split.panel_of:
        raise ManifestError(f"{where}: location {loc!r} is not in split {split.version!r}")
    if split.panel_of[loc] != panel:
        raise ManifestError(f"{where}: panel leakage, record says {panel!r} but split {split.version!r} puts {loc} in {split.panel_of[loc]!r}")
    mode, status = _req(rec, "render_mode", where), _req(rec, "status", where)
    if mode not in RENDER_MODES:
        raise ManifestError(f"{where}: unknown render_mode {mode!r}")
    if status not in STATUSES:
        raise ManifestError(f"{where}: unknown status {status!r}")
    if status == "excluded" and not rec.get("reason"):
        raise ManifestError(f"{where}: excluded record needs a reason")
    tgt = _req(rec, "target", where)
    if _req(tgt, "view_id", where + " target") != view_id:
        raise ManifestError(f"{where}: cross-view pairing, target belongs to {tgt['view_id']!r}")
    cam = _req(rec, "camera", where)
    if tgt.get("camera") is not None and tgt["camera"] != cam:
        raise ManifestError(f"{where}: target camera differs from capture camera")
    rects = tuple(tuple(float(v) for v in r) for r in tgt.get("ignore_rects") or ())
    for r in rects:
        if len(r) != 4 or not (0 <= r[0] < r[2] <= 1 and 0 <= r[1] < r[3] <= 1):
            raise ManifestError(f"{where}: bad ignore_rect {r} (want [x0,y0,x1,y1] fractions)")
    mask = rec.get("class_mask")
    if mask is not None and _req(mask, "view_id", where + " class_mask") != view_id:
        raise ManifestError(f"{where}: cross-view pairing, class mask belongs to {mask['view_id']!r}")
    if mask is not None and tuple(mask.get("classes", CLASSES)) != CLASSES:
        raise ManifestError(f"{where}: class_mask classes must be {CLASSES}")
    complete = status == "complete"
    # an incomplete/excluded capture may have no file or size (the capture writer emits null); a complete one must
    cap = _req(rec, "capture", where) if complete else (rec.get("capture") or {})
    size = [int(_req(rec, k, where)) if complete else int(rec.get(k) or 0) for k in ("width", "height")]
    r = Record(
        build_id=_req(rec, "build_id", where), commit=_req(rec, "commit", where), run_id=_req(rec, "run_id", where),
        panel=panel, location_id=loc, view_id=view_id, camera=cam,
        width=size[0], height=size[1], render_mode=mode,
        target_path=_path(base, _req(tgt, "path", where)), target_sha256=_req(tgt, "sha256", where),
        target_version=_req(tgt, "version", where), ignore_rects=rects,
        mask_path=_path(base, mask["path"]) if mask else None,
        capture_path=_path(base, _req(cap, "path", where)) if complete else (_path(base, cap["path"]) if cap.get("path") else None),
        capture_sha256=_req(cap, "sha256", where) if complete else cap.get("sha256"),
        status=status, reason=rec.get("reason"), raw=rec)
    if check_files and complete:
        for label, p, h in (("target", r.target_path, r.target_sha256), ("capture", r.capture_path, r.capture_sha256)):
            if not p.exists():
                raise ManifestError(f"{where}: {label} file missing: {p}")
            if sha256(p) != h:
                raise ManifestError(f"{where}: {label} sha256 mismatch: {p}")
        if r.mask_path is not None and mask.get("sha256") and sha256(r.mask_path) != mask["sha256"]:
            raise ManifestError(f"{where}: class_mask sha256 mismatch")
        if _png_size(r.capture_path) != (r.width, r.height):
            raise ManifestError(f"{where}: capture is {_png_size(r.capture_path)}, record says {(r.width, r.height)}")
    return r


@dataclass(frozen=True)
class Manifest:
    path: str
    split: Split
    records: tuple

    def scorable(self, build_id=None, run_id=None):
        return [r for r in self.records if r.scorable and (build_id is None or r.build_id == build_id)
                and (run_id is None or r.run_id == run_id)]

    def expected(self, build_id=None, run_id=None):
        """Score-mode records of every status: the coverage denominator."""
        return [r for r in self.records if r.render_mode == "score" and (build_id is None or r.build_id == build_id)
                and (run_id is None or r.run_id == run_id)]

    def resolve(self, build_id, run_id=None):
        """-> (build_id, run_id). A build with several runs needs an explicit run: runs are never merged."""
        runs = self.runs(build_id)
        if not runs:
            raise ManifestError(f"no records for build {build_id!r}")
        if run_id is None:
            if len(runs) != 1:
                raise ManifestError(f"build {build_id!r} has runs {runs}; name one as {build_id}:<run>")
            return build_id, runs[0]
        if run_id not in runs:
            raise ManifestError(f"build {build_id!r} has no run {run_id!r} (runs: {runs})")
        return build_id, run_id

    def builds(self):
        return sorted({r.build_id for r in self.records})

    def runs(self, build_id):
        return sorted({r.run_id for r in self.records if r.build_id == build_id})


def load_manifest(path, split: Split, check_files: bool = True) -> Manifest:
    path = pathlib.Path(path)
    base = path.parent
    recs = []
    for i, line in enumerate(path.read_text().splitlines(), 1):
        if line.strip():
            recs.append(parse_record(json.loads(line), split, base, f"{path.name}:{i}", check_files))
    if not recs:
        raise ManifestError(f"{path}: empty manifest")
    seen, target_owner = set(), {}
    for r in recs:
        key = (r.build_id, r.run_id, r.view_id, r.render_mode)
        if key in seen:
            raise ManifestError(f"{path}: duplicate record {key}")
        seen.add(key)
        owner = target_owner.setdefault(r.target_sha256, r.view_id)
        if owner != r.view_id:
            raise ManifestError(f"{path}: cross-view pairing, one target (sha {r.target_sha256[:12]}) serves {owner} and {r.view_id}")
    return Manifest(path=str(path), split=split, records=tuple(recs))
