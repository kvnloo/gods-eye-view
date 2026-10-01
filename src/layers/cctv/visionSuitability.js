const VISION_STATUSES = new Set(['ready', 'marginal', 'unsuitable', 'unknown']);

export const CCTV_VISION_SUITABILITY_STATUSES = Object.freeze([
  ...VISION_STATUSES,
]);

function safeString(value, maxLength = 200) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function finiteTimestamp(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function optionalShare(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function normalizeProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = safeString(value.source, 160);
  const method = safeString(value.method, 120);
  if (!source && !method) return null;
  return {
    ...(source ? { source } : {}),
    ...(method ? { method } : {}),
  };
}

/**
 * Normalize one provider-neutral camera vision qualification record.
 *
 * Non-unknown claims require a measured timestamp and provenance so a READY
 * label can never become anonymous, timeless authority in the UI.
 */
export function normalizeVisionSuitabilityRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const cameraId = safeString(value.cameraId, 160);
  const status = safeString(value.status, 40)?.toLowerCase() || null;
  if (!cameraId || !VISION_STATUSES.has(status)) return null;

  const measuredAt = finiteTimestamp(value.measuredAt);
  const provenance = normalizeProvenance(value.provenance);
  if (status !== 'unknown' && (measuredAt === null || !provenance)) return null;

  const medianObjectPx = optionalNonNegative(value.medianObjectPx);
  const usableShare = optionalShare(value.usableShare);
  const reason = safeString(value.reason, 240);

  return {
    cameraId,
    status,
    ...(medianObjectPx !== null ? { medianObjectPx } : {}),
    ...(usableShare !== null ? { usableShare } : {}),
    ...(reason ? { reason } : {}),
    ...(measuredAt !== null ? { measuredAt } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

export function emptyVisionSuitabilitySnapshot() {
  return {
    configured: false,
    source: null,
    records: [],
    received: 0,
    accepted: 0,
    dropped: 0,
    partial: false,
    error: null,
  };
}

/**
 * Normalize an optional qualification snapshot.
 *
 * Malformed siblings are dropped while valid rows survive. Provider error
 * strings are never surfaced verbatim.
 */
export function normalizeVisionSuitabilitySnapshot(value) {
  if (value?.configured === false) return emptyVisionSuitabilitySnapshot();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ...emptyVisionSuitabilitySnapshot(),
      configured: true,
      error: 'Vision qualification unavailable',
    };
  }
  if ('records' in value && !Array.isArray(value.records)) {
    return {
      ...emptyVisionSuitabilitySnapshot(),
      configured: true,
      source: safeString(value.source, 160),
      error: 'Vision qualification unavailable',
    };
  }

  const rawRecords = Array.isArray(value.records)
    ? value.records.slice(0, 5000)
    : [];
  const records = rawRecords
    .map(normalizeVisionSuitabilityRecord)
    .filter(Boolean);
  const dropped =
    (Array.isArray(value.records) ? value.records.length : 0) - records.length;

  return {
    configured: true,
    source: safeString(value.source, 160),
    records,
    received: Array.isArray(value.records) ? value.records.length : 0,
    accepted: records.length,
    dropped,
    partial: Boolean(value.partial || dropped > 0),
    error: value.error ? 'Vision qualification unavailable' : null,
  };
}

export function indexVisionSuitabilityByCamera(snapshot) {
  const index = new Map();
  if (!snapshot?.configured || !Array.isArray(snapshot.records)) return index;
  for (const record of snapshot.records) {
    const current = index.get(record.cameraId);
    const nextTime = Number(record.measuredAt) || Number.NEGATIVE_INFINITY;
    const currentTime = Number(current?.measuredAt) || Number.NEGATIVE_INFINITY;
    if (!current || nextTime > currentTime) index.set(record.cameraId, record);
  }
  return index;
}

export function formatVisionSuitabilityAge(ageMs) {
  const age = Math.max(0, Number(ageMs) || 0);
  if (age < 60_000) return `${Math.round(age / 1000)}s ago`;
  if (age < 60 * 60_000) return `${Math.round(age / 60_000)}m ago`;
  if (age < 24 * 60 * 60_000) return `${Math.round(age / (60 * 60_000))}h ago`;
  return `${Math.round(age / (24 * 60 * 60_000))}d ago`;
}

function statusLabel(status) {
  return (
    {
      ready: 'VISION · READY',
      marginal: 'VISION · MARGINAL',
      unsuitable: 'VISION · UNSUITABLE',
      unknown: 'VISION · UNKNOWN',
    }[status] || 'VISION · UNKNOWN'
  );
}

/**
 * Build a small camera-scoped presentation object without inferring a status.
 * Pixel/share measurements remain descriptive metadata; the producer owns the
 * qualification decision.
 */
export function summarizeVisionSuitability(
  snapshot,
  cameraId,
  {
    now = Date.now(),
    recordIndex = indexVisionSuitabilityByCamera(snapshot),
  } = {},
) {
  const id = safeString(cameraId, 160);
  if (!id || !snapshot?.configured) return null;

  const record = recordIndex.get(id) || null;
  if (!record) {
    return {
      cameraId: id,
      status: 'unknown',
      label: 'VISION · UNKNOWN',
      detail: snapshot.error
        ? 'Qualification source unavailable'
        : 'No qualification data',
      title: snapshot.error
        ? 'Qualification source unavailable'
        : 'No qualification data for this camera',
      cardDetails: [],
    };
  }

  const measuredAt = finiteTimestamp(record.measuredAt);
  const ageMs =
    measuredAt === null ? null : Math.max(0, Number(now) - measuredAt);
  if (snapshot.error) {
    const ageLabel = ageMs === null ? null : formatVisionSuitabilityAge(ageMs);
    const provenance =
      record.provenance?.source ||
      record.provenance?.method ||
      snapshot.source ||
      null;
    const detail = [
      'Qualification source unavailable',
      record.status ? `last ${record.status}` : null,
      ageLabel,
      provenance,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      cameraId: id,
      status: 'unknown',
      label: 'VISION · UNKNOWN',
      detail,
      title: ['VISION · UNKNOWN', detail].filter(Boolean).join(' · '),
      measuredAt,
      ageMs,
      ageLabel,
      provenance,
      reason: record.reason || null,
      medianObjectPx: record.medianObjectPx ?? null,
      usableShare: record.usableShare ?? null,
      cardDetails: [],
    };
  }
  const ageLabel = ageMs === null ? null : formatVisionSuitabilityAge(ageMs);
  const provenance =
    record.provenance?.source ||
    record.provenance?.method ||
    snapshot.source ||
    null;
  const metrics = [
    Number.isFinite(record.medianObjectPx)
      ? `median ${Math.round(record.medianObjectPx)}px`
      : null,
    Number.isFinite(record.usableShare)
      ? `${Math.round(record.usableShare * 100)}% usable`
      : null,
  ].filter(Boolean);
  const detail = [
    ageLabel,
    provenance,
    record.reason || null,
    metrics.length ? metrics.join(' · ') : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const label = statusLabel(record.status);

  return {
    cameraId: id,
    status: record.status,
    label,
    detail,
    title: [label, detail].filter(Boolean).join(' · '),
    measuredAt,
    ageMs,
    ageLabel,
    provenance,
    reason: record.reason || null,
    medianObjectPx: record.medianObjectPx ?? null,
    usableShare: record.usableShare ?? null,
    cardDetails:
      record.status === 'unknown'
        ? []
        : [
            label.replace('VISION · ', 'VISION '),
            [ageLabel, provenance].filter(Boolean).join(' · '),
          ].filter(Boolean),
  };
}
