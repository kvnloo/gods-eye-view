import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AREA_SCHEMA,
  composeCatalog,
  coreTools,
  defineTool,
  ToolError,
} from '../index.js';
import { toolsForSurface } from '../surfaces.js';
import { getWildfireIntelligence } from './wildfire.js';

const area = { lat: 36, lon: -120, radius_km: 50 };
const fixtureTool = (name, run) =>
  defineTool({
    name,
    title: name,
    description: 'Test fixture for ' + name,
    inputSchema: {
      type: 'object',
      properties: { area: AREA_SCHEMA, limit: { type: 'integer' } },
      required: ['area'],
      additionalProperties: false,
    },
    run,
  });
const catalogWith = (entries = {}, interceptors = [], services = {}) =>
  composeCatalog({
    tools: [
      getWildfireIntelligence,
      ...Object.entries(entries).map(([name, run]) => fixtureTool(name, run)),
    ],
    interceptors,
    services,
  });
const response = (rows, extra = {}) => ({
  summary: rows.length + ' results',
  data: { rows, total: rows.length, truncated: false, ...extra },
});

test('keeps source records separate without claiming smoke', async () => {
  const calls = [];
  const catalog = catalogWith(
    {
      get_active_fires: async (args) =>
        response(
          [{ lat: 36, lon: -120, acquired: '2026-10-19 10:00', frp_mw: 25 }],
          { fetched_at: '2026-10-19T17:00:00Z', missing_sources: [] },
        ),
      get_fire_perimeters: async () =>
        response([{ id: 'wfigs-1', updated: '2026-10-19T16:00:00Z' }]),
      find_cctv_cameras: async () =>
        response(
          [{ id: 'cam-1', lat: 36.01, lon: -120.02, heading_deg: null }],
          { complete: true, catalog_trimmed: [] },
        ),
    },
    [(call, next) => {
      calls.push(call.tool.name);
      return next(call);
    }],
  );
  const result = await catalog.call('get_wildfire_intelligence', { area });
  assert.deepEqual(calls, [
    'get_wildfire_intelligence',
    'get_active_fires',
    'get_fire_perimeters',
    'find_cctv_cameras',
  ]);
  assert.deepEqual(result.data.view.layers, [
    'local-firms',
    'fire-perimeters',
    'cctv',
  ]);
  assert.equal(result.data.sections.detections.provider, 'NASA FIRMS');
  assert.equal(result.data.sections.detections.total, 1);
  assert.equal(result.data.sections.detections.rows[0].frp_mw, 25);
  assert.equal(
    result.data.sections.detections.fetched_at,
    '2026-10-19T17:00:00Z',
  );
  assert.equal(result.data.sections.perimeters.rows[0].id, 'wfigs-1');
  assert.equal(result.data.sections.cameras.rows[0].id, 'cam-1');
  assert.equal(result.data.action_authority, 'none');
  assert.match(result.summary, /do not establish current fire behavior/);
  assert.equal(result.data.next_checks[1].tool, 'get_cctv_snapshot');
});

test('a missing FIRMS key does not suppress official perimeters', async () => {
  const catalog = catalogWith({
    get_active_fires: async () => {
      throw new ToolError('unavailable', 'NASA FIRMS key required');
    },
    get_fire_perimeters: async () => response([{ id: 'incident' }]),
  });
  const result = await catalog.call('get_wildfire_intelligence', { area });
  assert.equal(result.data.sections.detections.status, 'unavailable');
  assert.equal(
    result.data.sections.detections.reason,
    'NASA FIRMS key required',
  );
  assert.equal(result.data.sections.detections.total, null);
  assert.equal(result.data.sections.perimeters.status, 'available');
  assert.equal(result.data.sections.cameras.status, 'unavailable');
  assert.deepEqual(result.data.view.layers, ['fire-perimeters']);
});

test('distinguishes stale and partial evidence from zero rows', async () => {
  const catalog = catalogWith({
    get_active_fires: async () =>
      response([], { stale: true, missing_sources: ['VIIRS_SNPP_NRT'] }),
    get_fire_perimeters: async () => response([]),
    find_cctv_cameras: async () =>
      response([], { complete: false, catalog_trimmed: [{ pack: 'demo' }] }),
  });
  const result = await catalog.call('get_wildfire_intelligence', { area });
  const { detections, perimeters, cameras } = result.data.sections;
  assert.equal(detections.status, 'stale');
  assert.deepEqual(detections.issues, [
    'stale_cache',
    'missing_satellite_sources',
  ]);
  assert.deepEqual(detections.missing_sources, ['VIIRS_SNPP_NRT']);
  assert.equal(perimeters.status, 'available');
  assert.equal(perimeters.total, 0);
  assert.equal(cameras.status, 'partial');
  assert.deepEqual(cameras.catalog_trimmed, [{ pack: 'demo' }]);
  assert.match(result.data.caveats.at(-1), /not evidence/);
});

test('missing sources and failures preserve safe reasons', async () => {
  const none = await catalogWith().call('get_wildfire_intelligence', { area });
  assert.deepEqual(none.data.view.layers, []);
  assert.equal(none.data.sections.detections.total, null);
  assert.equal(
    none.data.sections.perimeters.reason,
    'Source is not configured',
  );

  const catalog = catalogWith({
    get_active_fires: async () => {
      throw new Error('private upstream URL /?api_key=secret');
    },
    get_fire_perimeters: async () => ({ summary: 'bad', data: { rows: null } }),
  });
  const result = await catalog.call('get_wildfire_intelligence', { area });
  assert.equal(
    result.data.sections.detections.reason,
    'Source unavailable right now',
  );
  assert.equal(result.data.sections.perimeters.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('resolves named areas once and preserves circular filters', async () => {
  let resolutions = 0;
  const seen = [];
  const services = {
    places: {
      resolve: async (name) => {
        resolutions += 1;
        assert.equal(name, 'Test Coast');
        return {
          name,
          bounds: { west: 179, south: 35, east: -179, north: 37 },
        };
      },
    },
  };
  const names = [
    'get_active_fires',
    'get_fire_perimeters',
    'find_cctv_cameras',
  ];
  const providers = Object.fromEntries(
    names.map((name) => [
      name,
      async (args) => {
        seen.push(args.area);
        return response([]);
      },
    ]),
  );
  const catalog = catalogWith(providers, [], services);
  const named = await catalog.call('get_wildfire_intelligence', {
    area: { place: 'Test Coast' },
  });
  assert.equal(resolutions, 1);
  assert.match(named.summary, /Test Coast/);
  assert.deepEqual(
    seen,
    Array(3).fill({ bbox: [179, 35, -179, 37] }),
  );

  const circle = { lat: 36, lon: -120, radius_km: 50 };
  await catalog.call('get_wildfire_intelligence', { area: circle });
  assert.equal(resolutions, 1);
  assert.deepEqual(seen.slice(3), Array(3).fill(circle));
});

test('passes limits and preserves cancellation', async () => {
  const seen = [];
  const catalog = catalogWith({
    get_active_fires: async (args) => {
      seen.push(args.limit);
      return response([]);
    },
    get_fire_perimeters: async (args) => {
      seen.push(args.limit);
      return response([]);
    },
  });
  await catalog.call('get_wildfire_intelligence', { area, limit: 3 });
  assert.deepEqual(seen, [3, 3]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    catalog.call(
      'get_wildfire_intelligence',
      { area, limit: 3 },
      { signal: controller.signal },
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(seen, [3, 3]);
  await assert.rejects(
    catalog.call('get_wildfire_intelligence', { area, limit: 26 }),
    { code: 'invalid_arguments' },
  );
});

test('mid-flight cancellation does not wait for a stalled optional source', async () => {
  let started;
  let release;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  const stalled = new Promise((resolve) => {
    release = resolve;
  });
  const nestedSignals = [];
  const catalog = catalogWith(
    {
      get_active_fires: async () => {
        started();
        // Deliberately ignore AbortSignal to model an uncooperative adapter.
        return stalled;
      },
      get_fire_perimeters: async () => response([{ id: 'incident' }]),
    },
    [
      (call, next) => {
        if (call.parent === 'get_wildfire_intelligence')
          nestedSignals.push(call.signal);
        return next(call);
      },
    ],
  );
  const controller = new AbortController();
  const pending = catalog.call(
    'get_wildfire_intelligence',
    { area },
    { signal: controller.signal },
  );
  await entered;
  controller.abort();

  // A canceled composite must settle before an uncooperative child is freed.
  const outcome = await Promise.race([
    pending.then(
      () => 'unexpected success',
      (error) => error?.name,
    ),
    new Promise((resolve) => setImmediate(() => resolve('still waiting'))),
  ]);
  release(response([{ id: 'late detection' }]));
  assert.equal(outcome, 'AbortError');
  assert.deepEqual(nestedSignals, Array(2).fill(controller.signal));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('caps uncooperative child sources and preserves true totals', async () => {
  const tooMany = Array.from({ length: 30 }, (_, id) => ({ id }));
  const catalog = catalogWith({
    get_active_fires: async () => ({
      summary: 'source omitted its truncation flag',
      data: { rows: tooMany, total: 30, truncated: false },
    }),
    get_fire_perimeters: async () => ({
      summary: 'upstream reported more matches than rows',
      data: { rows: [{ id: 'mapped' }], total: 9, truncated: false },
    }),
  });
  const result = await catalog.call('get_wildfire_intelligence', {
    area,
    limit: 3,
  });
  assert.equal(result.data.sections.detections.total, 30);
  assert.equal(result.data.sections.detections.returned, 3);
  assert.deepEqual(
    result.data.sections.detections.rows.map((row) => row.id),
    [0, 1, 2],
  );
  assert.equal(result.data.sections.detections.truncated, true);
  assert.equal(result.data.sections.perimeters.returned, 1);
  assert.equal(result.data.sections.perimeters.truncated, true);
  assert.equal(result.data.sections.cameras.status, 'unavailable');
});

test('rejects child counts that cannot describe their evidence rows', async () => {
  for (const total of [-1, 1, 1.5]) {
    const catalog = catalogWith({
      get_active_fires: async () => ({
        summary: 'inconsistent source',
        data: { rows: [{ id: 1 }, { id: 2 }], total },
      }),
      get_fire_perimeters: async () => response([{ id: 'incident' }]),
    });
    const result = await catalog.call('get_wildfire_intelligence', { area });
    assert.equal(result.data.sections.detections.status, 'unavailable');
    assert.match(
      result.data.sections.detections.reason,
      /returned malformed evidence/,
    );
    assert.equal(result.data.sections.detections.returned, 0);
    assert.equal(result.data.sections.perimeters.status, 'available');
  }
});

test('exposes MCP without redundant voice calls', () => {
  assert.ok(coreTools.includes(getWildfireIntelligence));
  assert.ok(
    toolsForSurface(coreTools, 'mcp').includes(getWildfireIntelligence),
  );
  assert.ok(
    !toolsForSurface(coreTools, 'voice').includes(getWildfireIntelligence),
  );
});
