import { evaluateDisasterRouteSupport } from './disasterAccess.js';

const DIRECTIONS_ACCESS_SCHEMA_VERSION = 1;

function nonEmptyText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function finiteNumber(value) {
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
  return geometry
    .map((pair) => [rounded(pair?.[0], 6), rounded(pair?.[1], 6)])
    .filter(
      ([lon, lat]) =>
        lon !== null &&
        lat !== null &&
        Math.abs(lon) <= 180 &&
        Math.abs(lat) <= 90,
    );
}

function fnv1a32(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
  return `osrm:${fnv1a32(canonical).toString(16).padStart(8, '0')}`;
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

  const evaluation = evaluateDisasterRouteSupport(
    { id: routeId, segmentIds },
    accessSegments,
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
    support: evaluation.support,
    segmentIds: evaluation.segmentIds,
    reasons: evaluation.reasons,
  });
}

/**
 * Whether a stored evaluation still describes the current route + access
 * revision. A changed route or evidence revision requires re-evaluation.
 */
export function isDirectionsDisasterAccessCurrent(
  receipt,
  { route, accessRevision } = {},
) {
  if (receipt?.schemaVersion !== DIRECTIONS_ACCESS_SCHEMA_VERSION) return false;
  const routeId = directionsRouteIdentity(route);
  const revision = nonEmptyText(accessRevision);
  if (!routeId || !revision) return false;
  return receipt.route?.id === routeId && receipt.accessRevision === revision;
}
