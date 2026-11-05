import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBhoteKoshiDisasterAccessPacket } from './bhoteKoshiDisasterAccess.js';

const eventUrl = new URL(
  '../../public/events/bhote-koshi-2026/event.json',
  import.meta.url,
);
const event = JSON.parse(await readFile(eventUrl, 'utf8'));

test('existing Bhote Koshi event pack becomes evidence without inventing access', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);

  assert.equal(packet.event.id, 'bhote-koshi-2026');
  assert.equal(packet.evidence.observations.length, 16);
  assert.equal(packet.access.segments.length, 0);
  assert.deepEqual(packet.gaps, ['access-not-assessed']);
});

test('bridge-named evidence remains an observation, not an access claim', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);
  const bridgeEvidence = packet.evidence.observations.filter((record) =>
    /bridge/i.test(record.title || ''),
  );

  assert.ok(bridgeEvidence.length >= 2);
  assert.equal(packet.access.segments.length, 0);
  assert.ok(
    bridgeEvidence.every((record) =>
      ['bidur-trishuli-bridge', 'devighat-taadi-khola-bridge', 'mailung-upper-trishuli']
        .includes(record.id),
    ),
  );
});

test('historical imagery observation times survive adaptation exactly', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);

  assert.equal(packet.evidence.imagery.before.observedAt, '2021-10-16');
  assert.equal(packet.evidence.imagery.after.observedAt, '2026-08-27');
  assert.match(packet.evidence.imagery.before.source, /WorldView-2/);
  assert.match(packet.evidence.imagery.after.source, /WorldView-3/);
});

test('unverified witness capture time stays unknown instead of becoming event date', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);
  const first = packet.evidence.observations[0];

  assert.equal(first.timing.capturedAt, null);
  assert.match(first.timing.note, /unverified/i);
  assert.notEqual(first.timing.capturedAt, packet.event.observedDate);
});

test('linked-media provenance and rights metadata survive the adapter', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);
  const first = packet.evidence.observations[0];

  assert.match(first.media.sourceUrl, /^https:\/\//);
  assert.match(first.media.rightsStatus, /not redistributed/i);
  assert.match(first.provenance.rights, /third-party link only/i);
});

test('synthetic access observations stay separate from historical event evidence', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event, {
    accessSegments: [
      {
        id: 'synthetic-road-a',
        state: 'blocked',
        determination: 'simulated',
        freshness: 'fresh',
        provenance: { source: 'test-fixture' },
      },
    ],
    candidateRoutes: [
      { id: 'candidate-a', segmentIds: ['synthetic-road-a'] },
    ],
  });

  assert.equal(packet.evidence.observations.length, 16);
  assert.equal(packet.access.segments.length, 1);
  assert.equal(packet.access.segments[0].determination, 'simulated');
  assert.equal(packet.routes[0].support, 'unsupported');
  assert.deepEqual(packet.routes[0].reasons, ['blocked:synthetic-road-a']);
});

test('reconstruction caveat remains attached to the evidence packet', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);

  assert.match(packet.evidence.reconstruction.label, /SCHEMATIC/i);
  assert.match(packet.evidence.reconstruction.caveat, /not an official hazard model/i);
});

test('unknown and malformed evidence coordinates never become locations near zero', () => {
  const cases = [
    { id: 'null', lat: null, lon: null, sequence: null },
    { id: 'blank', lat: '', lon: '  ', sequence: '' },
    { id: 'boolean', lat: false, lon: true, sequence: false },
    { id: 'nondecimal', lat: '0x10', lon: '0b10', sequence: '0x10' },
    { id: 'out-of-bounds', lat: 91, lon: 181, sequence: -1 },
    { id: 'fractional-index', lat: 27.1, lon: 85.5, sequence: 2.5 },
  ];
  const packet = buildBhoteKoshiDisasterAccessPacket({
    ...event, evidenceSpine: cases,
  });
  const records = packet.evidence.observations;
  assert.equal(records.length, cases.length, 'retain evidence rows with unknown positions');
  assert.ok(records.slice(0, 5).every((record) => record.position === null));
  assert.ok(records.every((record) => record.sequence === null));
  assert.deepEqual(records[5].position, { lat: 27.1, lon: 85.5 });
  assert.deepEqual(packet.gaps, ['access-not-assessed']);
  assert.equal(packet.access.segments.length, 0);
});

test('real equator coordinates, valid Nepal coordinates and numeric strings survive', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket({
    ...event,
    evidenceSpine: [
      { id: 'real-zero', lat: 0, lon: 0, sequence: 0 },
      { id: 'numeric', lat: '27.2', lon: '85.6', sequence: '2' },
      { id: 'range-limits', lat: -90, lon: 180, sequence: 3 },
    ],
  });
  assert.deepEqual(packet.evidence.observations.map((record) => record.position), [
    { lat: 0, lon: 0 }, { lat: 27.2, lon: 85.6 }, { lat: -90, lon: 180 },
  ]);
  assert.deepEqual(packet.evidence.observations.map((record) => record.sequence), [
    0, 2, 3,
  ]);
});

test('all source-owned observation IDs and capture-time evidence survive unchanged', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket(event);
  const observationIdentity = (record) => ({
    id: record.id,
    sequence: record.sequence,
    title: record.title,
    capturedAt: record.timing?.capturedAt ?? null,
    note: record.timing?.note ?? null,
  });

  assert.equal(packet.event.id, event.id);
  assert.equal(packet.event.title, event.title);
  assert.equal(packet.event.observedDate, event.observedDate);
  assert.equal(packet.evidence.observations.length, 16);
  assert.deepEqual(
    packet.evidence.observations.map(observationIdentity),
    event.evidenceSpine.map(observationIdentity),
  );
  for (const side of ['before', 'after']) {
    assert.equal(
      packet.evidence.imagery[side].observedAt,
      event.imagery[side].observedAt,
    );
    assert.equal(
      packet.evidence.imagery[side].source,
      event.imagery[side].source,
    );
  }
  assert.deepEqual(packet.access.segments, []);
  assert.deepEqual(packet.gaps, ['access-not-assessed']);
});

test('malformed record IDs cannot be coerced into source-owned observations', () => {
  const packet = buildBhoteKoshiDisasterAccessPacket({
    ...event,
    evidenceSpine: [
      { id: 7 },
      { id: {} },
      { id: [] },
      { id: '' },
      { id: '  ' },
      {
        id: 'source-owned-id',
        sequence: 1,
        timing: { capturedAt: '2021-10-16', note: 'source timestamp' },
      },
    ],
  });

  assert.deepEqual(
    packet.evidence.observations.map((record) => record.id),
    ['source-owned-id'],
  );
  assert.equal(packet.evidence.observations[0].timing.capturedAt, '2021-10-16');
  assert.deepEqual(packet.gaps, ['access-not-assessed']);
});

test('simulated open, degraded, blocked and stale access never alter bridge evidence', () => {
  const originalEvent = JSON.stringify(event);
  const bridgeId = 'bidur-trishuli-bridge';
  const originalBridge = event.evidenceSpine.find((record) => record.id === bridgeId);
  assert.ok(originalBridge);

  for (const [state, freshness] of [
    ['open', 'fresh'],
    ['degraded', 'fresh'],
    ['blocked', 'fresh'],
    ['open', 'stale'],
  ]) {
    const packet = buildBhoteKoshiDisasterAccessPacket(event, {
      accessSegments: [{
        id: bridgeId,
        state,
        determination: 'simulated',
        observedAt: '2026-08-26T12:00:00Z',
        freshness,
        provenance: { source: 'synthetic-test-only' },
      }],
      candidateRoutes: [{ id: 'test-candidate', segmentIds: [bridgeId] }],
    });
    const bridge = packet.evidence.observations.find((record) => record.id === bridgeId);
    assert.ok(bridge);
    assert.equal(bridge.id, originalBridge.id);
    assert.equal(bridge.timing.capturedAt, originalBridge.timing.capturedAt);
    assert.equal(Object.hasOwn(bridge, 'state'), false);
    assert.equal(Object.hasOwn(bridge, 'determination'), false);
    assert.equal(packet.evidence.observations.length, 16);
    assert.deepEqual(
      packet.evidence.observations.map((record) => record.id),
      event.evidenceSpine.map((record) => record.id),
    );
    assert.equal(packet.access.segments.length, 1);
    assert.equal(packet.access.segments[0].id, bridgeId);
    assert.equal(packet.access.segments[0].state, state);
    assert.equal(packet.access.segments[0].freshness, freshness);
    assert.equal(packet.access.segments[0].determination, 'simulated');
    assert.equal(packet.access.segments[0].provenance.source, 'synthetic-test-only');
    assert.equal(packet.routes[0].routeId, 'test-candidate');
  }
  assert.equal(JSON.stringify(event), originalEvent);
});
