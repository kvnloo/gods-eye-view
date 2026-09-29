import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OBSERVED_TRAFFIC_FIXTURE_CORRIDOR,
  buildObservedTrafficFixtureSnapshot,
  createObservedTrafficCorridorFixtureSource,
  installObservedTrafficCorridorFixture,
  observedTrafficFixtureRequested,
  selectObservedTrafficFixtureCameras,
} from './observedTrafficFixture.js';

const NOW = Date.parse('2026-09-29T05:30:00Z');

function camera(id, overrides = {}) {
  return {
    id,
    name: id,
    city: 'Test',
    provider: 'Other',
    lat: 33.9,
    lon: -117.9,
    ...overrides,
  };
}

test('fixture mode is explicit and off by default', () => {
  assert.equal(observedTrafficFixtureRequested(''), false);
  assert.equal(
    observedTrafficFixtureRequested('?observedTraffic=fixture'),
    true,
  );
  assert.equal(
    observedTrafficFixtureRequested('?observedTraffic=live'),
    false,
  );
});

test('selector prefers named corridor cameras, then other Caltrans rows', () => {
  const selected = selectObservedTrafficFixtureCameras([
    camera('z-generic'),
    camera('ca-d12-other', { provider: 'Caltrans' }),
    camera('ca-d12-imperial', {
      name: 'Imperial Highway eastbound',
      provider: 'Caltrans',
    }),
    camera('ca-d12-brea', {
      city: 'Brea',
      provider: 'Caltrans',
    }),
  ]);
  assert.deepEqual(
    selected.map(({ id }) => id),
    ['ca-d12-brea', 'ca-d12-imperial', 'ca-d12-other', 'z-generic'],
  );
});

test('fixture snapshot uses real selected ids and includes stale plus missing states', () => {
  const cameras = [
    camera('a', { provider: 'Caltrans', name: 'Imperial Highway' }),
    camera('b', { provider: 'Caltrans' }),
    camera('c', { provider: 'Caltrans' }),
    camera('d', { provider: 'Caltrans' }),
  ];
  const snapshot = buildObservedTrafficFixtureSnapshot(cameras, { now: NOW });
  assert.equal(snapshot.records.length, 3);
  assert.deepEqual(
    snapshot.records.map(({ cameraId }) => cameraId),
    ['a', 'b', 'c'],
  );
  assert.equal(snapshot.records[0].geometry.type, 'intersection');
  assert.ok(NOW - snapshot.records[0].observedAt < 60_000);
  assert.ok(NOW - snapshot.records[1].observedAt > 5 * 60_000);
  assert.equal(snapshot.records.some(({ cameraId }) => cameraId === 'd'), false);
  assert.equal(
    snapshot.records[0].provenance.method,
    'synthetic-fixture',
  );
});

test('fixture source normalizes records through the observed traffic contract', async () => {
  const source = createObservedTrafficCorridorFixtureSource({
    clock: () => NOW,
  });
  const result = await source.request(
    {
      cameras: [
        camera('a', { provider: 'Caltrans', name: 'Imperial Highway' }),
        camera('b', { provider: 'Caltrans' }),
      ],
    },
    { now: NOW },
  );
  assert.equal(result.configured, true);
  assert.equal(result.accepted, 2);
  assert.equal(result.records[0].cameraId, 'a');
  assert.equal(result.records[0].quality.status, 'synthetic-fixture');
  assert.equal(result.records[1].cameraId, 'b');
  assert.equal(result.records[1].observedAt, NOW - 8 * 60 * 1000);
  assert.equal(result.stale, true);
});

test('controller enables both layers and refreshes once after real camera rows appear', async () => {
  const listeners = new Set();
  const selected = [];
  const cardOptions = [];
  const refreshes = [];
  const enables = [];
  const cctv = {
    subscribe(callback) {
      listeners.add(callback);
      callback({ cameras: [] });
      return () => listeners.delete(callback);
    },
    selectCamera(id, options) {
      selected.push([id, options]);
    },
    setCardPresentationOptions(options) {
      cardOptions.push(options);
    },
  };
  const traffic = {
    async refreshObservedTraffic(query, options) {
      refreshes.push([query, options]);
      return { state: 'partial' };
    },
  };
  const catalog = {
    get(id) {
      return id === 'cctv' ? cctv : id === 'traffic' ? traffic : null;
    },
  };
  const dataManager = {
    async setEnabled(id, enabled, options) {
      enables.push([id, enabled, options]);
      return true;
    },
  };
  const controller = new AbortController();
  const dispose = installObservedTrafficCorridorFixture({
    catalog,
    dataManager,
    signal: controller.signal,
  });

  assert.deepEqual(
    enables.map(([id, enabled]) => [id, enabled]),
    [
      ['traffic', true],
      ['cctv', true],
    ],
  );

  const cameras = [
    camera('ca-d12-imperial', {
      name: 'Imperial Highway',
      provider: 'Caltrans',
    }),
    camera('ca-d12-other', { provider: 'Caltrans' }),
  ];
  for (const listener of [...listeners]) listener({ cameras });
  for (const listener of [...listeners]) listener({ cameras });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(refreshes.length, 1);
  assert.equal(
    refreshes[0][0].corridorId,
    OBSERVED_TRAFFIC_FIXTURE_CORRIDOR,
  );
  assert.deepEqual(
    refreshes[0][0].cameras.map(({ id }) => id),
    ['ca-d12-imperial', 'ca-d12-other'],
  );
  assert.deepEqual(selected, [['ca-d12-imperial', { focus: false }]]);
  assert.deepEqual(cardOptions, [{ activeCameraCardEnabled: true }]);

  dispose();
  assert.equal(listeners.size, 0);
});

test('aborting fixture controller unsubscribes without another refresh', async () => {
  const listeners = new Set();
  const controller = new AbortController();
  let refreshes = 0;
  const dispose = installObservedTrafficCorridorFixture({
    catalog: {
      get(id) {
        if (id === 'cctv')
          return {
            subscribe(callback) {
              listeners.add(callback);
              return () => listeners.delete(callback);
            },
          };
        if (id === 'traffic')
          return {
            async refreshObservedTraffic() {
              refreshes++;
            },
          };
        return null;
      },
    },
    dataManager: { setEnabled: async () => true },
    signal: controller.signal,
  });
  controller.abort();
  assert.equal(listeners.size, 0);
  for (const listener of [...listeners])
    listener({ cameras: [camera('a')] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 0);
  dispose();
});
