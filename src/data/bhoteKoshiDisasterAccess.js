import { buildDisasterAccessPacket } from './disasterAccess.js';

function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function evidenceRecord(record) {
  if (!record || typeof record !== 'object' || !record.id) return null;
  const lat = finiteCoordinate(record.lat);
  const lon = finiteCoordinate(record.lon);

  return Object.freeze({
    id: String(record.id),
    sequence: Number.isFinite(Number(record.sequence))
      ? Number(record.sequence)
      : null,
    title: typeof record.title === 'string' ? record.title : null,
    summary: typeof record.summary === 'string' ? record.summary : null,
    phase: typeof record.phase === 'string' ? record.phase : null,
    position: lat !== null && lon !== null ? Object.freeze({ lat, lon }) : null,
    timing: Object.freeze({
      capturedAt:
        typeof record.timing?.capturedAt === 'string'
          ? record.timing.capturedAt
          : null,
      note: typeof record.timing?.note === 'string' ? record.timing.note : null,
    }),
    confidence: record.confidence ?? null,
    media:
      record.media && typeof record.media === 'object'
        ? Object.freeze({
            sourceUrl:
              typeof record.media.sourceUrl === 'string'
                ? record.media.sourceUrl
                : null,
            platform:
              typeof record.media.platform === 'string'
                ? record.media.platform
                : null,
            rightsStatus:
              typeof record.media.rightsStatus === 'string'
                ? record.media.rightsStatus
                : null,
          })
        : null,
    provenance: record.provenance ?? null,
  });
}

function imageryRecord(record) {
  if (!record || typeof record !== 'object') return null;
  return Object.freeze({
    observedAt:
      typeof record.observedAt === 'string' ? record.observedAt : null,
    label: typeof record.label === 'string' ? record.label : null,
    source: typeof record.source === 'string' ? record.source : null,
    path: typeof record.path === 'string' ? record.path : null,
  });
}

/**
 * Adapt the already-shipped Bhote Koshi reconstruction into the generic
 * disaster-access packet without inferring road or bridge state.
 *
 * Evidence remains evidence. Access remains unassessed until supplied by a
 * separate explicit access source.
 */
export function buildBhoteKoshiDisasterAccessPacket(
  event,
  { accessSegments = [], candidateRoutes = [] } = {},
) {
  const packet = buildDisasterAccessPacket({
    event,
    accessSegments,
    candidateRoutes,
  });

  const evidence = Array.isArray(event?.evidenceSpine)
    ? event.evidenceSpine.map(evidenceRecord).filter(Boolean)
    : [];

  return Object.freeze({
    ...packet,
    evidence: Object.freeze({
      observations: Object.freeze(evidence),
      imagery: Object.freeze({
        before: imageryRecord(event?.imagery?.before),
        after: imageryRecord(event?.imagery?.after),
      }),
      reconstruction: Object.freeze({
        label:
          typeof event?.reconstruction?.label === 'string'
            ? event.reconstruction.label
            : null,
        caveat:
          typeof event?.reconstruction?.caveat === 'string'
            ? event.reconstruction.caveat
            : null,
      }),
      geolocationMap:
        event?.geolocationMap && typeof event.geolocationMap === 'object'
          ? Object.freeze({
              credit:
                typeof event.geolocationMap.credit === 'string'
                  ? event.geolocationMap.credit
                  : null,
              sourceUrl:
                typeof event.geolocationMap.sourceUrl === 'string'
                  ? event.geolocationMap.sourceUrl
                  : null,
            })
          : null,
    }),
  });
}
