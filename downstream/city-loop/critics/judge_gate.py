#!/usr/bin/env python3
"""judge_gate.py: refuse any image that may show Google Photorealistic 3D Tiles.

The Map Tiles API policies forbid "image analysis" and "machine interpretation"
of Google tiles, and the Google/Cesium terms forbid storing them or putting
them in documents (loop-v3/licence/REPORT.md, items 10-13). So every image a
critic (VLM panel, proxy metrics) or a gallery reads must pass this gate first.

An image passes only when it is tagged Google-free:
  1. a judge frame from capture.mjs --own / --judge-only: the manifest.json next
     to it lists it in `frames` with "googleTiles": false and the same sha256; or
  2. a derived image (resize, jpg) or a non-capture reference (an owner target,
     a bookmark ref) with a sidecar `<image>.tiles.json`:
       {"googleTiles": false, "kind": "derived", "from": "<path of a passing image>"}
       {"googleTiles": false, "kind": "reference", "source": "<where it came from>"}
     A derived image passes only if its `from` passes too.
Anything else is refused: untagged frames, frames tagged googleTiles true or
unknown, a sha256 mismatch, and any path inside the ephemeral Google dir.

  judge_gate.py check IMG [IMG ...]     # exit 2 and a JSON list of refusals if any fail
  judge_gate.py derive SRC DST          # write DST's sidecar after checking SRC (DST must exist)
"""
import hashlib
import json
import os
import sys
from pathlib import Path

EPHEMERAL_MARK = 'gev-EPHEMERAL-google-tiles'


class Refused(Exception):
    pass


def _sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def require(path, _depth=0):
    """Return the tag record for `path`, or raise Refused."""
    p = Path(path).resolve()
    if EPHEMERAL_MARK in str(p):
        raise Refused(f'{p}: inside the ephemeral Google-tiles dir')
    if not p.is_file():
        raise Refused(f'{p}: not a file')
    if _depth > 4:
        raise Refused(f'{p}: derivation chain too deep')
    side = p.with_name(p.name + '.tiles.json')
    if side.is_file():
        tag = json.loads(side.read_text())
        if tag.get('googleTiles') is not False:
            raise Refused(f'{p}: sidecar does not say googleTiles false')
        if tag.get('sha256') and tag['sha256'] != _sha(p):
            raise Refused(f'{p}: changed after tagging')
        if tag.get('kind') == 'derived':
            require(Path(p.parent, tag['from']) if not Path(tag['from']).is_absolute() else tag['from'], _depth + 1)
            return tag
        if tag.get('kind') == 'reference' and tag.get('source'):
            return tag
        raise Refused(f'{p}: sidecar kind must be derived or reference')
    man = p.parent / 'manifest.json'
    if not man.is_file():
        raise Refused(f'{p}: untagged (no manifest.json frames entry, no sidecar)')
    m = json.loads(man.read_text())
    rec = (m.get('frames') or {}).get(p.name)
    if not rec:
        raise Refused(f'{p}: not a tagged frame in {man.name}')
    if rec.get('googleTiles') is not False:
        raise Refused(f'{p}: tagged googleTiles={rec.get("googleTiles")!r}')
    if rec.get('sha256') != _sha(p):
        raise Refused(f'{p}: sha256 differs from the tag')
    return rec


def check(paths):
    bad = []
    for x in paths:
        try:
            require(x)
        except Refused as e:
            bad.append(str(e))
    return bad


def derive(src, dst):
    require(src)
    d = Path(dst).resolve()
    # relative, so a folder of frames keeps passing after it is copied elsewhere
    tag = {'googleTiles': False, 'kind': 'derived', 'from': os.path.relpath(Path(src).resolve(), d.parent), 'sha256': _sha(d)}
    d.with_name(d.name + '.tiles.json').write_text(json.dumps(tag, indent=1) + '\n')
    return tag


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] not in ('check', 'derive'):
        print(__doc__)
        sys.exit(64)
    if sys.argv[1] == 'derive':
        print(json.dumps(derive(sys.argv[2], sys.argv[3])))
        sys.exit(0)
    bad = check(sys.argv[2:])
    print(json.dumps({'checked': len(sys.argv) - 2, 'refused': bad}, indent=1))
    sys.exit(2 if bad else 0)
