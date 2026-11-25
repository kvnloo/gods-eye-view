#!/usr/bin/env python3
"""Evaluate city placements in one judge frame against its OSM fixture."""
import json
import math
import sys

from osm_geo import Fixture, ang_diff90, area, centroid, poly_yaw, sample_poly


def evaluate(frame, fixture):
    failures = []
    placements = frame['placements']
    if frame['beat'] in ('build', 'shadow', 'growth') and not any(
        p['kind'] == ('growth' if frame['beat'] == 'growth' else 'massing')
        for p in placements
    ):
        failures.append({'check': 'missing-placement'})

    expected = frame['expectedPlace'].casefold()
    label = frame['hud'].casefold()
    if not expected or expected != label:
        failures.append({'check': 'hud-place', 'expected': expected, 'actual': frame['hud']})

    for placement in placements:
        def fail(check, **details):
            failures.append({'check': check, 'id': placement['id'], **details})

        poly = [fixture.local(*point) for point in placement['footprint']]
        if len(poly) < 3 or not all(math.isfinite(v) for p in poly for v in p) or abs(area(poly)) < 0.01:
            fail('invalid-footprint')
            continue
        centre = centroid(poly)
        street, _, _ = fixture.street_orientation(*centre)
        if street is None:
            fail('missing-street-grid')
        else:
            yaw = poly_yaw(poly)
            delta = ang_diff90(yaw, street)
            if delta > 5:
                fail('yaw', delta_deg=round(delta, 2), yaw_deg=round(yaw, 2), street=round(street, 2))
        hits = fixture.water_hits(poly, tol=0)
        if hits['waterPoints'] or hits['shoreCrossings']:
            fail('water', **hits)
        if any(fixture.water_at(*p) is None for p in sample_poly(poly)):
            fail('missing-water-coverage')
        overlaps = fixture.buildings_overlapping(poly)
        if overlaps:
            fail('existing-building', count=len(overlaps))
        height = placement['base']
        samples = placement['terrain']
        if (height is None or not math.isfinite(height)
                or len(samples) != len(poly) + 1
                or any(z is None or not math.isfinite(z) for z in samples)):
            fail('missing-terrain')
        else:
            low, high = height - max(samples), height - min(samples)
            if low < -0.5:
                fail('sunk', metres=round(-low, 2))
            if high > 0.5:
                fail('floating', metres=round(high, 2))
    return {'pass': not failures, 'failures': failures}


if __name__ == '__main__':
    try:
        result = evaluate(json.load(sys.stdin), Fixture(*sys.argv[1:]))
    except (OSError, ValueError, TypeError, KeyError, IndexError) as error:
        result = {'pass': False, 'failures': [{'check': 'invalid-evidence', 'error': str(error)}]}
    print(json.dumps(result))
    sys.exit(0 if result['pass'] else 2)
