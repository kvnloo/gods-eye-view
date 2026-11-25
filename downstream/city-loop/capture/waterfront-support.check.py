#!/usr/bin/env python3
"""Check hull, deck and piling coverage in a diagnostic city=hero Build.

Tint the Cruising Club hull red and the nearby pier decks green and pilings
magenta in buildingSupport. Bypass lighting for those tints, keeping depth
and the rest of the live diorama pipeline intact. Capture only Build with
--judge-only at the default camera and viewport.
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'critics'))
from judge_gate import require


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('frame', type=Path)
    args = parser.parse_args()
    path = args.frame
    record = require(path)
    manifest = json.loads(path.with_name('manifest.json').read_text())
    state = (manifest.get('diorama') or {}).get('state') or {}
    if (path.name != 'build--own.png' or record.get('kind') != 'judge'
            or record.get('sanity', {}).get('pass') is not True
            or manifest.get('judgeOnly') is not True or manifest.get('query') != 'city=hero'
            or state.get('fixture') != '/city-diorama/sausalito.osm.json'
            or state.get('ready') is not True):
        raise ValueError(f'{path}: expected a sanity-passing city=hero judge-only Build')
    with Image.open(path) as image:
        if image.size != (1600, 1000):
            raise ValueError(f'{path}: expected a 1600×1000 capture')
        # Native-pixel waterfront crop from the r13 hero Build. The two
        # pier clusters are separated by the open-water band at screen y=285.
        x0, y0, x1, y1 = 820, 205, 1110, 405
        crop = image.convert('RGB').crop((x0, y0, x1, y1))
        pixels = {kind: set() for kind in ('hull', 'near_deck', 'far_deck', 'near_piling', 'far_piling')}
        for i, (r, g, b) in enumerate(crop.getdata()):
            x, y = x0 + i % crop.width, y0 + i // crop.width
            pier = 'near' if y >= 285 else 'far'
            if r >= 200 and max(g, b) <= 55:
                pixels['hull'].add((x, y))
            elif g >= 200 and max(r, b) <= 55:
                pixels[f'{pier}_deck'].add((x, y))
            elif min(r, b) >= 200 and g <= 55:
                pixels[f'{pier}_piling'].add((x, y))

    # A 2x2 block requires resolved surface coverage in both dimensions.
    # A one-pixel seam or isolated antialiasing sample cannot satisfy it.
    coverage = {
        kind: {
            'pixels': len(points),
            'blocks_2x2': sum(
                (x + 1, y) in points and (x, y + 1) in points and (x + 1, y + 1) in points
                for x, y in points
            ),
        }
        for kind, points in pixels.items()
    }
    print(json.dumps(coverage))
    return 0 if all(surface['blocks_2x2'] for surface in coverage.values()) else 1


if __name__ == '__main__':
    sys.exit(main())
