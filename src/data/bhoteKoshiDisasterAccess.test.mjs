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
