import test from 'node:test';
import assert from 'node:assert/strict';
import { createNearbySearch } from './nearby.js';
import { areaAssessmentProxy } from '../area-assessment.js';

test('nearby acquisition reads only selected parameters, shares one actual service sample, and preserves failure', async () => {
  const hits = { air: 0, services: 0, housing: 0, seismic: 0 };
  const providers = Object.fromEntries(
    Object.keys(hits).map((metric) => [
      metric,
      async () => {
        hits[metric]++;
        return metric === 'services'
          ? { status: 'available', complete: true, pois: [] }
          : { status: 'unavailable', reason: 'Not covered' };
      },
    ]),
  );
  const result = await createNearbySearch(providers)(
    { lat: 0, lon: 0 },
    { metrics: ['air', 'services'], radius: 500 },
  );
  assert.equal(result.candidates.length, 9);
  assert.deepEqual(hits, { air: 9, services: 1, housing: 0, seismic: 0 });
  assert.ok(
    result.candidates.every(
      (row) => row.observations.air.status === 'unavailable',
    ),
  );
});

test('a busy nearby response does not poison a second location cache', async () => {
  const originalFetch = globalThis.fetch;
  let releaseFirst;
  const firstFetchGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let notifyFirst;
  const firstStarted = new Promise((resolve) => {
    notifyFirst = resolve;
  });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    if (fetchCount === 1) {
      notifyFirst();
      await firstFetchGate;
    }
    return new Response(
      JSON.stringify({ current: { us_aqi: 40, time: '2026-10-11T12:00' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  try {
    let handler;
    areaAssessmentProxy().configureServer({
      middlewares: {
        use(route, callback) {
          assert.equal(route, '/api/area-assessment');
          handler = callback;
        },
      },
    });
    const request = async (lat, lon) => {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        metric: 'nearby',
        metrics: 'air',
        radius: '500',
      });
      let result;
      await handler(
        {
          method: 'GET',
          url: `/?${params}`,
          headers: {},
          socket: { remoteAddress: '127.0.0.1' },
        },
        {
          writeHead(statusCode) {
            result = { statusCode };
          },
          end(value) {
            result.body = JSON.parse(value);
          },
        },
      );
      return result;
    };

    const first = request(37, -122);
    await firstStarted;
    const busy = await request(38, -123);
    assert.equal(busy.statusCode, 200);
    assert.equal(busy.body.status, 'unavailable');
    assert.match(busy.body.reason, /Another nearby search/);
    releaseFirst();
    assert.equal((await first).body.status, 'available');

    const retried = await request(38, -123);
    assert.equal(retried.body.status, 'available');
    assert.equal(retried.body.candidates.length, 9);
    assert.equal(fetchCount, 18);
  } finally {
    releaseFirst();
    globalThis.fetch = originalFetch;
  }
});
