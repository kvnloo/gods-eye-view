import assert from 'node:assert/strict';
import test from 'node:test';
import { AREA_SCHEMA, composeCatalog, coreTools, defineTool, ToolError } from '../index.js';
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
const catalogWith = (entries = {}, interceptors = []) =>
  composeCatalog({
    tools: [
      getWildfireIntelligence,
      ...Object.entries(entries).map(([name, run]) => fixtureTool(name, run)),
    ],
    interceptors,
  });
const response = (rows, extra = {}) => ({
  summary: rows.length + ' results',
  data: { rows, total: rows.length, truncated: false, ...extra },
});

test('fuses source-owned records without claiming a smoke detection', async () => {
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
        response([{ id: 'cam-1', lat: 36.01, lon: -120.02, heading_deg: null }], {
          complete: true,
          catalog_trimmed: [],
        }),
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
  assert.deepEqual(result.data.view.layers, ['local-firms', 'fire-perimeters', 'cctv']);
  assert.equal(result.data.sections.detections.provider, 'NASA FIRMS');
  assert.equal(result.data.sections.detections.total, 1);
  assert.equal(result.data.sections.detections.rows[0].frp_mw, 25);
  assert.equal(result.data.sections.detections.fetched_at, '2026-10-19T17:00:00Z');
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
  assert.equal(result.data.sections.detections.reason, 'NASA FIRMS key required');
  assert.equal(result.data.sections.detections.total, null);
  assert.equal(result.data.sections.perimeters.status, 'available');
  assert.equal(result.data.sections.cameras.status, 'unavailable');
  assert.deepEqual(result.data.view.layers, ['fire-perimeters']);
});

test('partial and stale data remain distinguishable, including zero records', async () => {
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
  assert.deepEqual(detections.issues, ['stale_cache', 'missing_satellite_sources']);
  assert.deepEqual(detections.missing_sources, ['VIIRS_SNPP_NRT']);
  assert.equal(perimeters.status, 'available');
  assert.equal(perimeters.total, 0);
  assert.equal(cameras.status, 'partial');
  assert.deepEqual(cameras.catalog_trimmed, [{ pack: 'demo' }]);
  assert.match(result.data.caveats.at(-1), /not evidence/);
});

test('missing sources and unexpected errors remain bounded and do not leak details', async () => {
  const none = await catalogWith().call('get_wildfire_intelligence', { area });
  assert.deepEqual(none.data.view.layers, []);
  assert.equal(none.data.sections.detections.total, null);
  assert.equal(none.data.sections.perimeters.reason, 'Source is not configured');

  const catalog = catalogWith({
    get_active_fires: async () => {
      throw new Error('private upstream URL /?api_key=secret');
    },
    get_fire_perimeters: async () => ({ summary: 'bad', data: { rows: null } }),
  });
  const result = await catalog.call('get_wildfire_intelligence', { area });
  assert.equal(result.data.sections.detections.reason, 'Source unavailable right now');
  assert.equal(result.data.sections.perimeters.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('limits reach sources and cancellation prevents a misleading result', async () => {
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
    catalog.call('get_wildfire_intelligence', { area, limit: 3 }, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.deepEqual(seen, [3, 3]);
  await assert.rejects(catalog.call('get_wildfire_intelligence', { area, limit: 26 }), {
    code: 'invalid_arguments',
  });
});

test('MCP exposes the composite; voice does not add redundant feed calls', () => {
  assert.ok(coreTools.includes(getWildfireIntelligence));
  assert.ok(toolsForSurface(coreTools, 'mcp').includes(getWildfireIntelligence));
  assert.ok(!toolsForSurface(coreTools, 'voice').includes(getWildfireIntelligence));
});
