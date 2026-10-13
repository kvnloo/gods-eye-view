/**
 * Conservative adapter for manually supplied public Nepal DoR status records.
 *
 * No fetching, road-network matching, timezone inference or freshness claims.
 * NAVIGATE API access/reuse rights must be reviewed before adding acquisition.
 */

const SOURCE_URL = 'https://navigate.dor.gov.np/app/recently-opened';
const STATE_BY_CLOSURE_TYPE = Object.freeze({
  OPEN: 'open',
  CLOSED: 'blocked',
  PARTIAL_OPEN: 'degraded',
});

const clean = (value) => typeof value === 'string' ? value.trim() : '';

export function adaptDorRoadStatusRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    return null;

  const recordId = String(record.id ?? '').trim();
  const roadRef = clean(record.roadRefNumber).toUpperCase();
  const linkCode = clean(record.linkCode).toUpperCase();
  const publisher = clean(record.lastUpdatedBy);
  if (
    !/^\d{1,12}$/.test(recordId) ||
    !/^NH\d{2}$/.test(roadRef) ||
    !/^NH\d{2}-\d{3,4}$/.test(linkCode) ||
    !linkCode.startsWith(`${roadRef}-`) ||
    !publisher
  )
    return null;

  const closureType = clean(record.closureType).toUpperCase();
  const state = STATE_BY_CLOSURE_TYPE[closureType] || 'unknown';
  return Object.freeze({
    id: `nepal-dor:${linkCode}`,
    state,
    determination: 'declared',
    freshness: 'unknown',
    observedAt: null,
    receivedAt: null,
    provenance: Object.freeze({
      authority: 'Nepal Department of Roads',
      sourceUrl: SOURCE_URL,
      recordId,
      roadRef,
      linkCode,
      publisher,
      locationText: clean(record.location),
      closureTypeRaw: closureType,
      localDateText: clean(record.openDate),
      timeZone: 'unverified',
      reuseRights: 'unverified',
    }),
  });
}
