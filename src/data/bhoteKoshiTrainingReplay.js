import {
  createHistoricalReplayScenario,
  historicalReplayValueRevision,
} from './historicalReplay.js';

const ACCESS_FIXTURE_ID = 'access:synthetic-bridge-segment';

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function eventEvidence(record) {
  const normalized = {
    id: text(record?.id),
    title: text(record?.title),
    summary: text(record?.summary),
    phase: text(record?.phase),
    observedAt: text(record?.timing?.capturedAt),
    timingNote: text(record?.timing?.note),
    confidence: record?.confidence ?? null,
    position:
      Number.isFinite(Number(record?.lat)) &&
      Number.isFinite(Number(record?.lon))
        ? { lat: Number(record.lat), lon: Number(record.lon) }
        : null,
    provenance: record?.provenance ?? null,
    rights: {
      media: text(record?.media?.rightsStatus),
      provenance: text(record?.provenance?.rights),
    },
  };
  if (!normalized.id) return null;
  return {
    ...normalized,
    revision: historicalReplayValueRevision(
      `bhote-koshi-evidence:${normalized.id}`,
      normalized,
    ),
  };
}

function imageryEvidence(slot, record) {
  if (!record || typeof record !== 'object') return null;
  const normalized = {
    id: `imagery:${slot}`,
    kind: 'imagery',
    slot,
    observedAt: text(record.observedAt),
    label: text(record.label),
    source: text(record.source),
    path: text(record.path),
  };
  return {
    ...normalized,
    revision: historicalReplayValueRevision(
      `bhote-koshi-imagery:${slot}`,
      normalized,
    ),
  };
}

function accessMutation(id, revision, state, freshness) {
  return {
    id,
    kind: 'upsert-evidence',
    record: {
      id: ACCESS_FIXTURE_ID,
      revision,
      kind: 'access-observation',
      state,
      freshness,
      determination: 'simulated',
      observedAt: '2026-08-27T00:00:00Z',
      provenance: {
        source: 'HUM-04 facilitator fixture',
        method: 'simulated-training-injection',
      },
      rights: { status: 'synthetic fixture' },
    },
  };
}

/**
 * Build the first offline historical-training fixture from the already shipped
 * Bhote Koshi event pack. Historical evidence remains evidence; explicit
 * simulated access observations occupy a separate id and are never written
 * back to the event pack.
 */
export function createBhoteKoshiTrainingReplay(event) {
  const eventId = text(event?.id);
  const observedDate = text(event?.observedDate);
  if (!eventId || !observedDate) {
    throw new TypeError('Bhote Koshi event id and observedDate are required');
  }

  const observations = (Array.isArray(event.evidenceSpine)
    ? event.evidenceSpine
    : []
  )
    .map(eventEvidence)
    .filter(Boolean);
  const imagery = [
    imageryEvidence('before', event?.imagery?.before),
    imageryEvidence('after', event?.imagery?.after),
  ].filter(Boolean);
  const eventRevision = historicalReplayValueRevision('bhote-koshi-event', {
    schemaVersion: event.schemaVersion ?? null,
    id: eventId,
    observedDate,
    evidence: observations.map(({ id, revision }) => ({ id, revision })),
    imagery: imagery.map(({ id, revision }) => ({ id, revision })),
  });

  return createHistoricalReplayScenario({
    id: 'bhote-koshi-access-training-v1',
    title: `${text(event.title) || 'Bhote Koshi'} access reasoning replay`,
    event: {
      id: eventId,
      title: text(event.title),
      observedAt: observedDate,
      revision: eventRevision,
    },
    evidence: [...observations, ...imagery],
    mutations: [
      accessMutation(
        'facilitator-blocked-segment-r1',
        'simulated-access:r1-blocked',
        'blocked',
        'fresh',
      ),
      accessMutation(
        'facilitator-stale-open-r2',
        'simulated-access:r2-stale-open',
        'open',
        'stale',
      ),
    ],
    checkpoints: [
      {
        id: 'baseline-access-assessment',
        label: 'Assess access using historical event evidence only',
        expectedAssessment: 'unknown',
        requiredEvidenceIds: [],
        watchedEvidenceIds: [ACCESS_FIXTURE_ID],
      },
      {
        id: 'blocked-segment-reassessment',
        label: 'Reassess after an explicit simulated blocked segment arrives',
        expectedAssessment: 'unsupported',
        requiredEvidenceIds: [ACCESS_FIXTURE_ID],
        watchedEvidenceIds: [ACCESS_FIXTURE_ID],
      },
      {
        id: 'stale-open-reassessment',
        label: 'Reassess after blocked evidence is replaced by stale-open evidence',
        expectedAssessment: 'unknown',
        requiredEvidenceIds: [ACCESS_FIXTURE_ID],
        watchedEvidenceIds: [ACCESS_FIXTURE_ID],
      },
    ],
    rights: {
      policy: 'preserve-source-specific-rights',
      geolocationMap: {
        credit: text(event?.geolocationMap?.credit),
        sourceUrl: text(event?.geolocationMap?.sourceUrl),
      },
      imagery: imagery.map(({ id, source }) => ({ id, source })),
      linkedMediaNotRedistributed: observations.every(
        (record) =>
          !record.rights.media || /not redistributed/i.test(record.rights.media),
      ),
    },
    provenance: {
      sourceEventPath: '/events/bhote-koshi-2026/event.json',
      reconstructionLabel: text(event?.reconstruction?.label),
      reconstructionCaveat: text(event?.reconstruction?.caveat),
      historicalEvidenceCount: observations.length,
      syntheticAccessFixtureId: ACCESS_FIXTURE_ID,
    },
  });
}

export { ACCESS_FIXTURE_ID as BHOTE_KOSHI_TRAINING_ACCESS_FIXTURE_ID };
