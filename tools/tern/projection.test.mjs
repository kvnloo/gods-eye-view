import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSnapshot, plainSummary } from './projection.mjs';

function sample() {
  return {
    type: 'snapshot',
    capturedAt: 1200,
    change: 'selection',
    camera: { latitude: 41.1, longitude: -87.9, heightM: 500, heading: 90, pitch: -30 },
    selected: {
      id: 'flight:🚀',
      name: 'Launch \u001b[31m\n alert',
      source: 'ADS-B',
      layerId: 'flights',
      updatedAt: 1000,
    },
    layers: [
      {
        id: 'flights',
        name: 'Flights',
        enabled: true,
        feedState: 'stale',
        source: 'OpenSky',
        count: 40,
        lastUpdate: 1000,
        error: 'network offline',
      },
    ],
  };
}

test('normalizes Unicode safely, strips controls and retains provenance', () => {
  const actual = normalizeSnapshot(sample(), 1300);
  assert.equal(actual.selected.id, 'flight:🚀');
  assert.ok(!actual.selected.name.includes('\u001b'));
  assert.ok(!actual.selected.name.includes('\n'));
  assert.equal(actual.layers[0].feedState, 'stale');
  assert.equal(actual.layers[0].count, 40);
  assert.equal(actual.camera.heightM, 500);
  assert.deepEqual(Object.isFrozen(actual), true);
  assert.deepEqual(Object.isFrozen(actual.layers[0]), true);
  assert.match(plainSummary(actual), /STALE.*OpenSky/);
  assert.match(plainSummary(actual), /not complete or verified worldwide/);
});

test('refuses unknown messages; clamps untrusted fields without crashing', () => {
  assert.equal(normalizeSnapshot({ type: 'action', layers: [] }), null);
  assert.equal(normalizeSnapshot({ type: 'snapshot', layers: {} }), null);
  const message = sample();
  message.layers.push({ ...message.layers[0] });
  message.layers.push({
    id: 'evil',
    enabled: true,
    feedState: 'fabricated',
    source: 's'.repeat(2000),
    count: -100,
  });
  message.selected.latitude = Infinity;
  message.camera.longitude = -210;
  const value = normalizeSnapshot(message);
  assert.equal(value.layers.length, 2);
  assert.equal(value.layers[1].feedState, 'unavailable');
  assert.equal(value.layers[1].source.length, 160);
  assert.equal(value.layers[1].count, null);
  assert.equal(value.selected.latitude, null);
  assert.equal(value.camera.longitude, null);
});

test('fallback handles empty camera and never emits control sequences', () => {
  const value = normalizeSnapshot({ type: 'snapshot', layers: [], camera: null });
  const printed = plainSummary(value, { link: 'http://localhost:4173/' });
  assert.match(printed, /Selected: none/);
  assert.match(printed, /Globe: http:\/\/localhost:4173\//);
  assert.ok(!printed.includes('\u001b'));
  assert.match(plainSummary(null, { connected: false }), /No current browser snapshot/);
});

test('partial AIS coverage is preserved through normalization and plaintext', () => {
  const message = sample();
  message.layers[0].feedState = 'partial';
  message.selected.status = 'stale (missed polls)';
  const normalized = normalizeSnapshot(message, 1500);
  assert.equal(normalized.layers[0].feedState, 'partial');
  assert.equal(normalized.selected.status, 'stale (missed polls)');
  const printed = plainSummary(normalized, { now: 5000 });
  assert.match(printed, /PARTIAL.*OpenSky/);
  assert.match(printed, /Observation status: stale \(missed polls\)/);
  assert.match(printed, /Context refreshed: .*not source observation age/);
  assert.match(printed, /Browser capture: /);
});

test('bounds preserve Unicode scalar boundaries at the exact UTF-16 limit', () => {
  const message = sample();
  message.selected.name = 'a'.repeat(159) + '🚀';
  message.layers[0].source = 'b'.repeat(159) + '𐀀';
  let normalized = normalizeSnapshot(message);
  assert.equal(normalized.selected.name, 'a'.repeat(159));
  assert.equal(normalized.layers[0].source, 'b'.repeat(159));
  assert.equal(normalized.selected.name, normalized.selected.name.toWellFormed());
  message.selected.name = 'a'.repeat(158) + '🚀';
  message.layers[0].source = 'x\uD800y';
  normalized = normalizeSnapshot(message);
  assert.equal(normalized.selected.name, 'a'.repeat(158) + '🚀');
  assert.equal(normalized.layers[0].source, 'x\uFFFDy');
});

test('freshness ages advance against presentation time without new snapshots', () => {
  const value = normalizeSnapshot(sample(), 3000);
  const early = plainSummary(value, { connected: true, now: 4000 });
  const late = plainSummary(value, { connected: true, now: 124000 });
  assert.match(early, /Browser capture: 2s ago/);
  assert.match(late, /Browser capture: 2m ago/);
  assert.match(late, /relay received: 2m ago/);
});
