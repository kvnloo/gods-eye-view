import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeObservedTrafficRecord,
  normalizeObservedTrafficSnapshot,
} from './observed.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const valid = (overrides = {}) => ({
  id: 'fixture:approach',
  sourceId: 'synthetic-only',
  observedAt: NOW,
  geometry: { type: 'intersection', coordinates: [-87.63, 41.88] },
  flow: { vehiclesPerMin: 0, counts: {} },
  ...overrides,
});

test('missing or structured coordinates do not become a location', () => {
  for (const value of [null, undefined, true, false, '', ' ', [], [0], {}]) {
    for (const coordinates of [[value, 41.88], [-87.63, value]]) {
      assert.equal(normalizeObservedTrafficRecord(valid({
        geometry: { type: 'intersection', coordinates },
      })), null, `invalid coordinate ${JSON.stringify(coordinates)}`);
    }
  }
});

test('decimal coordinates retain signed zero and exponent notation', () => {
  for (const [value, expected] of [[0, 0], ['0', 0], ['-0', -0],
    [' +4.188e1 ', 41.88], ['.5', 0.5], ['1.', 1]]) {
    const record = normalizeObservedTrafficRecord(valid({
      geometry: { type: 'intersection', coordinates: [value, value] },
    }));
    assert.ok(record);
    assert.equal(record.geometry.coordinates[0], expected);
    assert.equal(record.geometry.coordinates[1], expected);
  }
});

test('nondecimal coordinates do not become plausible points', () => {
  for (const value of ['0x10', '0b10', '0o10', 'Infinity', 'NaN', '1e999']) {
    assert.equal(normalizeObservedTrafficRecord(valid({
      geometry: { type: 'intersection', coordinates: [value, 41] },
    })), null);
  }
});

test('sparse road and approach geometry fail closed', () => {
  for (const type of ['road-segment', 'approach']) {
    for (const coordinates of [new Array(2), [[-87, 41], , [-86, 41]],
      [, [-86, 41]], [[-87, 41], ,]]) {
      assert.equal(normalizeObservedTrafficRecord(valid({
        geometry: { type, coordinates },
      })), null);
    }
  }
});

test('invalid flow rates are absent rather than measured zero', () => {
  for (const value of [null, true, false, '', ' ', [], [0], {}, '0x10', '0b10', '0o10']) {
    assert.equal(normalizeObservedTrafficRecord(valid({
      flow: { vehiclesPerMin: value, counts: {} },
    })), null, `invalid rate ${JSON.stringify(value)}`);
  }
});

test('invalid count entries do not become observed evidence', () => {
  for (const value of [null, true, false, '', ' ', [], [0], {}, '0x10']) {
    assert.equal(normalizeObservedTrafficRecord(valid({
      flow: { counts: { car: value } },
    })), null);
  }
});

test('invalid movement measurements cannot invent evidence', () => {
  for (const value of [true, false, ' ', [], [0], '0b10']) {
    const record = normalizeObservedTrafficRecord(valid({
      flow: {}, movements: [{ count: value, vehiclesPerMin: value }],
    }));
    assert.equal(record, null);
  }
});

test('valid zero rates counts and movement measurements remain evidence', () => {
  const record = normalizeObservedTrafficRecord(valid({
    flow: { vehiclesPerMin: '0', counts: { car: ' 0 ', heavyVehicle: '2e1' } },
    movements: [{ count: '0', vehiclesPerMin: '.5' }],
  }));
  assert.equal(record.flow.vehiclesPerMin, 0);
  assert.deepEqual(record.flow.counts, { car: 0, heavyVehicle: 20 });
  assert.deepEqual(record.movements, [{ count: 0, vehiclesPerMin: 0.5 }]);
});

test('invalid quality values are not confidence scores', () => {
  for (const score of [true, false, ' ', [], [0], {}, '0x0', '0b1']) {
    const record = normalizeObservedTrafficRecord(valid({
      quality: { status: 'unverified', score },
    }));
    assert.deepEqual(record.quality, { status: 'unverified' });
  }
});

test('valid zero confidence stays explicit rather than becoming unknown', () => {
  const record = normalizeObservedTrafficRecord(valid({ quality: { score: '0' } }));
  assert.deepEqual(record.quality, { score: 0 });
});

test('bad siblings degrade a snapshot without removing valid zero evidence', () => {
  const sparse = [[-87, 41], , [-86, 41]];
  const snapshot = normalizeObservedTrafficSnapshot({ records: [
    valid(),
    valid({ id: 'bad-coordinate', geometry: { type: 'intersection', coordinates: [null, 0] } }),
    valid({ id: 'bad-rate', flow: { vehiclesPerMin: true } }),
    valid({ id: 'bad-line', geometry: { type: 'road-segment', coordinates: sparse } }),
  ] }, { now: NOW });
  assert.equal(snapshot.state, 'partial');
  assert.equal(snapshot.received, 4);
  assert.equal(snapshot.accepted, 1);
  assert.equal(snapshot.dropped, 3);
  assert.equal(snapshot.records[0].flow.vehiclesPerMin, 0);
});
