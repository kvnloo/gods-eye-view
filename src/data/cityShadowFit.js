// The shadow decision for an assumed massing block: how far its shadow reaches
// against a protected edge across the street, and the most storeys that still
// clear it. Pure: metres, degrees, UTC epoch milliseconds. An estimate on
// level ground from the block's height and the sun, never a daylight study.
import { MAX_STOREYS, localFrame } from './cityMassing.js';
import { shadowReach, sunPosition } from './citySun.js';

/** A storey's floor-to-floor: a fit changes the storey count, never this. */
export const FLOOR_TO_FLOOR_METERS = Object.freeze({ min: 2.8, max: 4.5 });
/** How far the protected edge is assumed to be until the player sets it. */
export const ASSUMED_EDGE_METERS = 20;
const MINUTE = 60_000;

function fail(message) {
  throw new TypeError(message);
}

/**
 * A block of `storeys` against an edge `edgeMeters` beyond its face, along the
 * shadow. Each line holds a storey count, its height, its shadow reach and
 * `overMeters` = reach − edge (above zero the shadow is on the edge, otherwise
 * it clears it by that much); reach and over are null while the sun is down or
 * unknown. `now` is the block as it stands, `was` the count it was changed
 * from (null when unchanged) and `fit` the most storeys that still clear the
 * edge: never more than now, never fewer than one (`cannotClear` when even one
 * storey reaches). `lines` are the two to draw: was and now after a change,
 * else now and the fit when it would cut (`canFit`).
 */
export function shadowFit({
  storeys,
  wasStoreys = storeys,
  storeyHeightMeters,
  sun,
  edgeMeters,
}) {
  for (const count of [storeys, wasStoreys])
    if (!Number.isInteger(count) || count < 1 || count > MAX_STOREYS)
      fail(`storeys must be a whole number from 1 to ${MAX_STOREYS}`);
  const { min, max } = FLOOR_TO_FLOOR_METERS;
  if (!(storeyHeightMeters >= min && storeyHeightMeters <= max))
    fail(`floor-to-floor must be ${min} to ${max} metres`);
  if (!Number.isFinite(edgeMeters) || edgeMeters <= 0)
    fail('the protected edge must be a positive number of metres away');
  const line = (kind, count) => {
    const heightMeters = count * storeyHeightMeters;
    const reachMeters = shadowReach(heightMeters, sun);
    return Object.freeze({
      kind,
      storeys: count,
      heightMeters,
      reachMeters,
      overMeters: reachMeters === null ? null : reachMeters - edgeMeters,
    });
  };
  const now = line('now', storeys);
  const up = now.reachMeters !== null;
  // Storeys whose shadow stops at or before the edge.
  const clear =
    up && Math.floor(edgeMeters / shadowReach(storeyHeightMeters, sun));
  const fit = up ? line('fit', Math.min(storeys, Math.max(1, clear))) : null;
  const was = wasStoreys === storeys ? null : line('was', wasStoreys);
  const canFit = up && fit.storeys < storeys;
  return Object.freeze({
    estimated: true,
    edgeMeters,
    now,
    was,
    fit,
    canFit,
    cannotClear: up && clear < 1,
    lines: Object.freeze(
      !up ? [] : was ? [was, now] : canFit ? [now, fit] : [now],
    ),
  });
}

// A block's shadow on the ground: `along` runs from the face the shadow leaves
// (zero) away from the sun, `across` spans the block's width.
function shadowFrame(footprint, sun) {
  const frame = localFrame(footprint);
  const az = (sun.azimuthDeg * Math.PI) / 180;
  const [ux, uy] = [-Math.sin(az), -Math.cos(az)];
  const along = frame.points.map(([x, y]) => x * ux + y * uy);
  const across = frame.points.map(([x, y]) => y * ux - x * uy);
  const face = Math.max(...along);
  return {
    left: Math.min(...across),
    right: Math.max(...across),
    distance: (lonLat) => {
      const [x, y] = frame.toMeters(lonLat);
      return x * ux + y * uy - face;
    },
    point: (meters, side) =>
      frame.toLonLat([
        (face + meters) * ux - side * uy,
        (face + meters) * uy + side * ux,
      ]),
  };
}

/**
 * The ground a shadow of `meters` covers beyond the block's face, as [lon,
 * lat] corners: near left, near right, far right, far left. The far side is
 * the shadow's tip, and at the edge's distance it is the protected edge,
 * drawn `pad` metres wider on each side.
 */
export function shadowBand(footprint, sun, meters, pad = 0) {
  const { left, right, point } = shadowFrame(footprint, sun);
  return [
    point(0, left - pad),
    point(0, right + pad),
    point(meters, right + pad),
    point(meters, left - pad),
  ];
}

/** How far a ground point is beyond the block's face, along the shadow. */
export function edgeDistance(footprint, sun, lonLat) {
  return shadowFrame(footprint, sun).distance(lonLat);
}

/** Whether a scene time is in winter there: December to February north of the equator, June to August south of it. */
export function inWinter(lat, ms) {
  return (lat >= 0 ? [11, 0, 1] : [5, 6, 7]).includes(
    new Date(ms).getUTCMonth(),
  );
}

/**
 * Solar noon on the winter solstice (21 December north of the equator, 21
 * June south of it) of the scene's year, as UTC epoch ms: the minute citySun's
 * sun stands highest, searched around mean solar noon.
 */
export function winterNoon(lat, lon, ms) {
  const mean =
    Date.UTC(new Date(ms).getUTCFullYear(), lat >= 0 ? 11 : 5, 21, 12) -
    (lon / 15) * 60 * MINUTE;
  let noon = mean;
  let highest = -Infinity;
  for (let at = mean - 20 * MINUTE; at <= mean + 20 * MINUTE; at += MINUTE) {
    const { elevationDeg } = sunPosition(lat, lon, at);
    if (elevationDeg > highest) [noon, highest] = [at, elevationDeg];
  }
  return noon;
}
