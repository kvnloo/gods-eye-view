import assert from 'node:assert/strict';
import test from 'node:test';
import { composeCatalog, coreTools } from '../index.js';
import { createToolServices } from '../services.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const imagery = (latest) => ({
  snapshots: [],
  boxes: [],
  async latest({ box }) {
    this.boxes.push(box);
    return latest;
  },
  async getSnapshot(request) {
    this.snapshots.push(request);
    return { contentType: 'image/png', bytes: PNG };
  },
});
const austin = { bbox: [-97.9, 30.1, -97.5, 30.5] };

test('the most recent clear image is returned with its date and sensor', async () => {
  const service = imagery({
    candidate: {
      product: 'S30',
      day: '2026-09-28',
      cloud: { min: 2, max: 6 },
      coverage: 'full',
    },
    reason: 'clear',
    certain: true,
    errors: [],
  });
  const catalog = composeCatalog({
    tools: coreTools,
    services: { imagery: service },
  });
  const result = await catalog.call('get_recent_imagery', { area: austin });
  assert.equal(
    result.summary,
    'Most recent image of the requested box: Sentinel-2 (30 m), 2026-09-28, clear, 2–6% cloud.',
  );
  assert.deepEqual(result.images, [
    { mimeType: 'image/png', data: 'iVBORw==' },
  ]);
  assert.deepEqual(service.snapshots[0], {
    product: 'S30',
    day: '2026-09-28',
    box: { west: -97.9, south: 30.1, east: -97.5, north: 30.5 },
    width: 1024,
    height: 1024,
    signal: undefined,
  });
});

test('a cloudy pick is named the least cloudy image, not the most recent', async () => {
  const catalog = composeCatalog({
    tools: coreTools,
    services: {
      imagery: imagery({
        candidate: {
          product: 'S30',
          day: '2026-09-22',
          cloud: { min: 8, max: 30 },
          coverage: 'full',
        },
        reason: 'cloudy',
        certain: true,
        errors: [],
      }),
    },
  });
  assert.equal(
    (await catalog.call('get_recent_imagery', { area: austin })).summary,
    'Least cloudy recent image of the requested box: Sentinel-2 (30 m), 2026-09-22, cloudy, 8–30% cloud.',
  );
});

test('overview fallback, empty results and invalid areas are reported', async () => {
  const overview = composeCatalog({
    tools: coreTools,
    services: {
      imagery: imagery({
        candidate: { product: 'VIIRS', day: '2026-10-01', cloud: null },
        reason: 'overview',
        errors: [{ product: 'S30' }],
      }),
    },
  });
  const coarse = await overview.call('get_recent_imagery', { area: austin });
  assert.equal(
    coarse.summary,
    'Most recent image of the requested box: VIIRS daily overview (250 m), 2026-10-01, coarse overview.',
  );
  assert.deepEqual(coarse.data.search_errors, ['S30']);
  const none = composeCatalog({
    tools: coreTools,
    services: { imagery: imagery({ candidate: null, reason: null }) },
  });
  assert.equal(
    (await none.call('get_recent_imagery', { area: austin })).summary,
    'No recent satellite image covers the requested box.',
  );
  await assert.rejects(
    none.call('get_recent_imagery', { area: { bbox: [-120, 20, -60, 50] } }),
    /too large for imagery/,
  );
  await assert.rejects(
    none.call('get_recent_imagery', { area: { bbox: [170, 0, -170, 5] } }),
    /antimeridian/,
  );
  await assert.rejects(
    none.call('get_recent_imagery', { area: { bbox: [0, 85.5, 1, 86] } }),
    /±85° latitude/,
  );
});

test('get_recent_imagery chooses the least cloudy CMR day through the real service', async () => {
  const newestDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const clearerDay = new Date(Date.now() - 5 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const cmrGranule = (day, cloud) => ({
    meta: { 'concept-id': `S30-${day}` },
    umm: {
      TemporalExtent: {
        RangeDateTime: { BeginningDateTime: `${day}T12:00:00Z` },
      },
      AdditionalAttributes: [
        { Name: 'CLOUD_COVERAGE', Values: [String(cloud)] },
      ],
      SpatialExtent: {
        HorizontalSpatialDomain: {
          Geometry: {
            BoundingRectangles: [
              {
                WestBoundingCoordinate: -98,
                SouthBoundingCoordinate: 30,
                EastBoundingCoordinate: -97,
                NorthBoundingCoordinate: 31,
              },
            ],
          },
        },
      },
    },
  });
  const requests = [];
  const fetchImpl = async (url) => {
    const request = String(url);
    requests.push(request);
    if (request.includes('/search/granules.umm_json')) {
      const s30 = request.includes('C2021957295');
      return new Response(
        JSON.stringify({
          hits: s30 ? 2 : 0,
          items: s30
            ? [cmrGranule(newestDay, 83), cmrGranule(clearerDay, 30)]
            : [],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    assert.ok(
      request.startsWith('https://wvs.earthdata.nasa.gov/api/v1/snapshot'),
    );
    return new Response(PNG, {
      headers: { 'content-type': 'image/png' },
    });
  };
  const services = createToolServices({
    fetchImpl,
    appUrl: 'http://127.0.0.1:4173',
  });
  const catalog = composeCatalog({ tools: coreTools, services });
  const result = await catalog.call('get_recent_imagery', { area: austin });
  assert.equal(result.data.image.day, clearerDay);
  assert.equal(result.data.image.quality, 'cloudy');
  assert.equal(result.data.image.cloud_pct.max, 30);
  assert.match(result.summary, /^Least cloudy recent image/);
  assert.deepEqual(result.images, [
    { mimeType: 'image/png', data: 'iVBORw==' },
  ]);
  const cmrRequests = requests.filter((url) => url.includes('granules.umm_json'));
  const snapshots = requests.filter((url) => url.includes('/api/v1/snapshot'));
  assert.equal(cmrRequests.length, 2, 'both CMR collections are queried');
  assert.equal(snapshots.length, 1, 'the selected image is fetched once');
});
