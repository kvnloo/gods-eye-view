import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OBSERVED_TRAFFIC_RENDER_LIMIT,
  planObservedTrafficRendering,
} from './observedRendering.js';

const NOW = Date.parse('2026-09-29T07:00:00Z');

function record(id, overrides = {}) {
  return {
    id,
    sourceId: 'fixture',
    observedAt: NOW - 10_000,
    geometry: {
      type: 'intersection',
      coordinates: [-117.9, 33.9],
    },
    flow: { vehiclesPerMin: 18, counts: { car: 15, heavyVehicle: 3 } },
    quality: { status: 'measured' },
    provenance: { source: 'fixture' },
    ...overrides,
  };
}

test('unconfigured observed traffic produces no spatial overlay', () => {
  assert.deepEqual(
    planObservedTrafficRendering({ configured: false, records: [] }),
    [],
  );
});

test('intersection observation preserves measured identity and freshness', () => {
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'fresh',
      records: [record('a')],
    },
    { now: NOW },
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, 'a');
  assert.equal(plan[0].measurement, '18 veh/min');
  assert.equal(plan[0].stale, false);
  assert.deepEqual(plan[0].geometry.coordinates, [-117.9, 33.9]);
});

test('old evidence remains renderable but is explicitly stale', () => {
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'fresh',
      records: [
        record('a', {
          observedAt: NOW - 900_000,
          windowEnd: NOW - 900_000,
        }),
      ],
    },
    { now: NOW, staleAfterMs: 120_000 },
  );
  assert.equal(plan[0].stale, true);
});

test('error-backed retained evidence is rendered stale', () => {
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'error',
      error: 'Observed traffic source unavailable',
      records: [record('a')],
    },
    { now: NOW },
  );
  assert.equal(plan[0].stale, true);
});

test('road and approach geometry are admitted without becoming simulated dots', () => {
  const coordinates = [
    [-117.9, 33.9],
    [-117.89, 33.9],
  ];
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'fresh',
      records: [
        record('road', {
          geometry: { type: 'road-segment', coordinates },
        }),
        record('approach', {
          geometry: { type: 'approach', coordinates },
        }),
      ],
    },
    { now: NOW },
  );
  assert.deepEqual(
    plan.map(({ geometry }) => geometry.type).sort(),
    ['approach', 'road-segment'],
  );
});

test('invalid geometry is skipped without hiding valid siblings', () => {
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'partial',
      records: [
        record('valid'),
        record('bad', {
          geometry: { type: 'intersection', coordinates: [NaN, 33.9] },
        }),
      ],
    },
    { now: NOW },
  );
  assert.deepEqual(plan.map(({ id }) => id), ['valid']);
});

test('duplicate observation ids keep only the newest record', () => {
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'fresh',
      records: [
        record('dup', {
          observedAt: NOW - 60_000,
          flow: { vehiclesPerMin: 4, counts: {} },
        }),
        record('dup', {
          observedAt: NOW - 5_000,
          flow: { vehiclesPerMin: 12, counts: {} },
        }),
      ],
    },
    { now: NOW },
  );
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, 'dup');
  assert.equal(plan[0].measurement, '12 veh/min');
});

test('render plan is recent-first and bounded', () => {
  const records = Array.from(
    { length: OBSERVED_TRAFFIC_RENDER_LIMIT + 20 },
    (_, index) =>
      record(`r-${index}`, {
        observedAt: NOW - index * 1000,
      }),
  );
  const plan = planObservedTrafficRendering(
    { configured: true, state: 'fresh', records },
    { now: NOW },
  );
  assert.equal(plan.length, OBSERVED_TRAFFIC_RENDER_LIMIT);
  assert.equal(plan[0].id, 'r-0');
  assert.equal(
    plan.at(-1).id,
    `r-${OBSERVED_TRAFFIC_RENDER_LIMIT - 1}`,
  );
});

test('count-only records get a compact measurement label', () => {
  const plan = planObservedTrafficRendering(
    {
      configured: true,
      state: 'fresh',
      records: [
        record('counts', {
          flow: { counts: { car: 7, heavyVehicle: 2 } },
        }),
      ],
    },
    { now: NOW },
  );
  assert.equal(plan[0].measurement, '9 vehicles');
});
