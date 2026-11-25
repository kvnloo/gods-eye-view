#!/usr/bin/env python3
"""Verify that a water-only tint in the hero build reaches the captured PNG."""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'critics'))
from judge_gate import require


def load_water(path):
    record = require(path)
    manifest = json.loads(path.with_name('manifest.json').read_text())
    if (path.name != 'build--own.png' or record.get('kind') != 'judge'
            or record.get('sanity', {}).get('pass') is not True
            or manifest.get('judgeOnly') is not True or manifest.get('query') != 'city=hero'):
        raise ValueError(f'{path}: expected a sanity-passing city=hero judge-only build')
    with Image.open(path) as image:
        if image.size != (1600, 1000):
            raise ValueError(f'{path}: expected a 1600×1000 capture')
        return list(image.convert('RGB').crop((1150, 110, 1590, 330)).getdata())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('parent', type=Path)
    parser.add_argument('tinted', type=Path)
    args = parser.parse_args()
    parent = load_water(args.parent)
    tinted = load_water(args.tinted)
    # Select water-colored control pixels, then look for the diagnostic red
    # signal at the same positions. Allow shader lighting and color grading.
    water = [pixel for (r, g, b), pixel in zip(parent, tinted)
             if min(g, b) - r >= 35]
    hits = sum(r - max(g, b) >= 45 for r, g, b in water)
    print(json.dumps({'control_water_pixels': len(water), 'red_water_pixels': hits}))
    return 0 if len(water) >= 1000 and hits >= len(water) * 0.25 else 1


if __name__ == '__main__':
    sys.exit(main())
