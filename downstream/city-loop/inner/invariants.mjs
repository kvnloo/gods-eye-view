// FORK-ONLY (exp/city-loop-v5, fix1 inner loop): the placement and label
// invariants (loop-v5/ROOT-CAUSE-AND-PATTERNS.md, I1 + I2), checked the way
// critics/sanity_gate.py checks a judge frame, plus "inside its plot".
//
// I1 every new footprint: on land (0 water samples, no shore crossing),
//    inside its plot, yaw within 5 deg of the local street grid, base within
//    0.5 m of the terrain under it (footprint corners + centre), no overlap
//    with an existing OSM building.
// I2 the HUD place name derives from the current location ('—' when unknown).
import { angDiff90, area, centroid, inside, polyYaw, samplePoly } from './geo.mjs';

export const YAW_DEGREES = 5;
export const BASE_METERS = 0.5;

/**
 * Failures of one placement `{kind, id, footprint: [[lon, lat]], base, plot}`
 * against `fixture` (geo.mjs Fixture); `sample([lon, lat])` is the terrain.
 */
export function placementFailures(placement, fixture, sample) {
  const out = [];
  const fail = (check, details = {}) =>
    out.push({ check, kind: placement.kind, id: placement.id, ...details });
  const poly = (placement.footprint ?? []).map(([lon, lat]) => fixture.local(lon, lat));
  if (poly.length < 3 || !poly.flat().every(Number.isFinite) || Math.abs(area(poly)) < 0.01) {
    fail('invalid-footprint');
    return out;
  }
  const c = centroid(poly);
  const [street] = fixture.streetOrientation(...c);
  if (street === null) fail('missing-street-grid');
  else {
    const yaw = polyYaw(poly);
    const delta = angDiff90(yaw, street);
    if (delta > YAW_DEGREES)
      fail('yaw', { delta_deg: +delta.toFixed(2), yaw_deg: +yaw.toFixed(2), street: +street.toFixed(2) });
  }
  const hits = fixture.waterHits(poly, 0);
  if (hits.waterPoints || hits.shoreCrossings) fail('water', hits);
  if (samplePoly(poly).some((p) => fixture.waterAt(...p) === null)) fail('missing-water-coverage');
  const overlaps = fixture.buildingsOverlapping(poly);
  if (overlaps.length) fail('existing-building', { count: overlaps.length });
  if (placement.plot) {
    const cell = placement.plot.corners.map(([lon, lat]) => fixture.local(lon, lat));
    // 1 cm tolerance: a setback of 0 puts the footprint on the plot edge.
    const grown = cell.map(([x, y]) => [c[0] + (x - c[0]) * 1.0005, c[1] + (y - c[1]) * 1.0005]);
    if (!poly.every((p) => inside(p, grown))) fail('outside-plot');
  }
  const centre = fixture.lonlat(...c);
  const terrain = [...placement.footprint, centre].map((p) => sample(p));
  const base = placement.base;
  if (!Number.isFinite(base) || !terrain.every(Number.isFinite)) fail('missing-terrain');
  else {
    const low = base - Math.max(...terrain);
    const high = base - Math.min(...terrain);
    if (low < -BASE_METERS) fail('sunk', { metres: +(-low).toFixed(2) });
    if (high > BASE_METERS) fail('floating', { metres: +high.toFixed(2) });
  }
  return out;
}

/** I2: the label shown must be the location's own place name, or '—' when unknown. */
export function labelFailures({ shown, expected, where }) {
  const fold = (s) => String(s ?? '').trim().toLocaleLowerCase('en');
  if (fold(shown) === fold(expected)) return [];
  return [{ check: 'hud-place', where, expected, actual: shown ?? null }];
}
