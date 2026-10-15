import { evaluateDisasterRouteSupport } from './disasterAccess.js';

const DIRECTIONS_ACCESS_SCHEMA_VERSION = 1;

function nonEmptyText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function finiteNumber(value) {
  // Number(null), Number('') and Number(false) are zero, not coordinates.
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim()))
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, digits) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function normalizedGeometry(geometry) {
  if (!Array.isArray(geometry)) return [];
  const points = geometry.map((pair) => [
    rounded(pair?.[0], 6),
    rounded(pair?.[1], 6),
  ]);
  // Dropping an invalid point would silently change the route under review.
  if (
    points.some(
      ([lon, lat]) =>
        lon === null ||
        lat === null ||
        Math.abs(lon) > 180 ||
        Math.abs(lat) > 90,
    )
  )
    return [];
  return points;
}

function fnv1a64(value) {
  // Reduce receipt-identity collisions for distinct route geometries.
  let hash = 0xcbf29ce484222325n;
  for (const char of value) {
    hash ^= BigInt(char.charCodeAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

/**
 * Stable identity for one normalized Directions/OSRM result.
 *
 * This is a receipt identity, not an access claim. Geometry or route metadata
 * changing produces a different identity so old access evaluations cannot be
 * silently reused against a new candidate.
 */
export function directionsRouteIdentity(route) {
  const geometry = normalizedGeometry(route?.geometry);
  if (geometry.length < 2) return null;
  const canonical = JSON.stringify({
    source: 'osrm',
    mode: nonEmptyText(route?.mode),
    distanceM: rounded(route?.distanceM, 3),
    durationS: rounded(route?.durationS, 3),
    geometry,
  });
  return `osrm:${fnv1a64(canonical).toString(16).padStart(16, '0')}`;
}

function unverifiedAccessReasons(segmentIds, accessSegments) {
  if (!Array.isArray(segmentIds) || !Array.isArray(accessSegments))
    return [];
  const mapped = new Set(segmentIds);
  const reasons = new Set();
  for (const record of accessSegments) {
    const id = nonEmptyText(record?.id);
    if (!id || !mapped.has(id)) continue;
    if (!['observed', 'declared'].includes(record?.determination))
      reasons.add(`unverified-access-basis:${id}`);
    const provenance = record?.provenance;
    if (
      !nonEmptyText(record?.observedAt) ||
      !nonEmptyText(record?.receivedAt) ||
      !(nonEmptyText(provenance?.source) ||
        nonEmptyText(provenance?.authority))
    )
      reasons.add(`unattributed-access:${id}`);
  }
  return [...reasons].sort();
}

/**
 * Evaluate a Directions candidate against explicit disaster-access evidence.
 *
 * Segment association is supplied by a separate mapping owner. This module
 * never infers road openness from OSRM success, route geometry, imagery, or
 * nearby evidence.
 */
export function evaluateDirectionsDisasterAccess({
  route,
  segmentIds = [],
  accessSegments = [],
  accessRevision,
} = {}) {
  const routeId = directionsRouteIdentity(route);
  const revision = nonEmptyText(accessRevision);

  if (!routeId) {
    return Object.freeze({
      schemaVersion: DIRECTIONS_ACCESS_SCHEMA_VERSION,
      route: null,
      accessRevision: revision,
      support: 'unknown',
      segmentIds: Object.freeze([]),
      reasons: Object.freeze(['directions-route-unavailable']),
    });
  }

  if (!revision) {
    return Object.freeze({
      schemaVersion: DIRECTIONS_ACCESS_SCHEMA_VERSION,
      route: Object.freeze({
        id: routeId,
        source: 'osrm',
        mode: nonEmptyText(route?.mode),
        distanceM: finiteNumber(route?.distanceM),
        durationS: finiteNumber(route?.durationS),
      }),
      accessRevision: null,
      support: 'unknown',
      segmentIds: Object.freeze([]),
      reasons: Object.freeze(['access-revision-missing']),
    });
  }

  const validAccessCollection = Array.isArray(accessSegments);
  const evidence = validAccessCollection ? accessSegments : [];
  const evaluation = evaluateDisasterRouteSupport(
    { id: routeId, segmentIds },
    evidence,
  );
  const unverified = unverifiedAccessReasons(
    evaluation.segmentIds,
    evidence,
  );

  return Object.freeze({
    schemaVersion: DIRECTIONS_ACCESS_SCHEMA_VERSION,
    route: Object.freeze({
      id: routeId,
      source: 'osrm',
      mode: nonEmptyText(route?.mode),
      distanceM: finiteNumber(route?.distanceM),
      durationS: finiteNumber(route?.durationS),
    }),
    accessRevision: revision,
    support:
      unverified.length || !validAccessCollection
        ? 'unknown'
        : evaluation.support,
    segmentIds: evaluation.segmentIds,
    reasons: Object.freeze([
      ...evaluation.reasons,
      ...(!validAccessCollection ? ['invalid-access-collection'] : []),
      ...unverified,
    ]),
  });
}

function normalizedSegmentIds(segmentIds) {
  if (!Array.isArray(segmentIds)) return null;
  return [...new Set(segmentIds.map(nonEmptyText).filter(Boolean))].sort();
}

/**
 * Whether a stored evaluation still describes the current route, explicit
 * segment association and access revision. Any change requires re-evaluation.
 * Missing current mapping does not establish that a receipt is still current.
 */
export function isDirectionsDisasterAccessCurrent(
  receipt,
  { route, accessRevision, segmentIds } = {},
) {
  if (receipt?.schemaVersion !== DIRECTIONS_ACCESS_SCHEMA_VERSION) return false;
  const routeId = directionsRouteIdentity(route);
  const revision = nonEmptyText(accessRevision);
  const currentSegments = normalizedSegmentIds(segmentIds);
  const previousSegments = normalizedSegmentIds(receipt.segmentIds);
  if (!routeId || !revision || !currentSegments || !previousSegments)
    return false;
  return (
    receipt.route?.id === routeId &&
    receipt.accessRevision === revision &&
    currentSegments.length === previousSegments.length &&
    currentSegments.every((id, index) => id === previousSegments[index])
  );
}
