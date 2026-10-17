// Integration follow-through for daikaginza's #686 and Sunil56224972's #923.
// Exercises the real middleware, shared gate, limiter and disk cache over
// loopback HTTP. Provider replies and flush scheduling are controlled fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { terrainHeightsProxy } from '../server/providers/terrain.js';

const point = '-97.74000,30.26000';
const key = point;
const result = { ellipsoid: 150 };

async function fixture(t, install = 'configureServer') {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), 'gev686-same-site-'));
  const cachePath = path.join(dir, 'terrain-heights.json');
  await fsp.writeFile(cachePath, JSON.stringify({ version: 2, points: {
    [key]: { at: Date.now(), result },
  } }));
  const stats = { stat: 0, read: 0, fetch: 0, flushes: 0 };
  const stat = fsp.stat.bind(fsp);
  const readFile = fsp.readFile.bind(fsp);
  t.mock.method(fsp, 'stat', async (file, ...args) => {
    if (file === cachePath) stats.stat++;
    return stat(file, ...args);
  });
  t.mock.method(fsp, 'readFile', async (file, ...args) => {
    if (file === cachePath) stats.read++;
    return readFile(file, ...args);
  });
  t.mock.method(globalThis, 'setInterval', () => {
    stats.flushes++;
    return { unref() {} };
  });
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(String(url)).hostname, 'terrain.reearth.land');
    stats.fetch++;
    const points = new URL(String(url)).searchParams.get('points').split(';');
    return Response.json({ results: points.map(() => result) });
  });
  let handler;
  terrainHeightsProxy({ cachePath })[install]({ middlewares: {
    use(route, fn) {
      assert.equal(route, '/api/terrain/heights');
      handler = fn;
    },
  } });
  assert.equal(typeof handler, 'function');
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ harnessError: error.message }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    t.mock.restoreAll();
    await fsp.rm(dir, { recursive: true, force: true });
  });
  const hit = (headers = {}, rawPoint = point) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method: 'GET',
      path: `/api/terrain/heights?points=${encodeURIComponent(rawPoint)}`,
      headers, agent: false,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers,
          body: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
  return { hit, stats, origin };
}

for (const install of ['configureServer', 'configurePreviewServer']) {
  test(`${install}: denied requests do no terrain work`, async (t) => {
    const { hit, stats, origin } = await fixture(t, install);
    const headers = [
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'image' },
      { origin: 'https://other.example' },
      { origin: 'null' },
      { origin, 'sec-fetch-site': 'same-site' },
      { origin, 'x-forwarded-for': '192.0.2.1' },
    ];
    for (const h of headers) {
      const response = await hit(h);
      assert.equal(response.status, 403, JSON.stringify(h));
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.match(response.headers['content-type'], /application\/json/);
      assert.equal(typeof response.body.error, 'string');
    }
    assert.deepEqual(stats, { stat: 0, read: 0, fetch: 0, flushes: 0 });
  });

  test(`${install}: valid browser and local callers retain cached results`, async (t) => {
    const { hit, stats, origin } = await fixture(t, install);
    for (const h of [{}, { origin, 'sec-fetch-site': 'same-origin' },
      { 'sec-fetch-site': 'none' },
      { host: '192.0.2.10:4173', origin: 'http://192.0.2.10:4173',
        'sec-fetch-site': 'same-origin' }]) {
      const response = await hit(h);
      assert.equal(response.status, 200);
      assert.equal(response.body.results[0].ellipsoid, 150);
    }
    assert.deepEqual(stats, { stat: 1, read: 1, fetch: 0, flushes: 1 });
  });
}

test('cross-site requests do not consume the legitimate client quota', async (t) => {
  const { hit, stats, origin } = await fixture(t);
  // Use a warm cached point to avoid any public provider traffic on either tree.
  for (let i = 0; i < 6; i++) await hit({ 'sec-fetch-site': 'cross-site' });
  const statuses = [];
  for (let i = 0; i < 90; i++) {
    statuses.push((await hit({ origin, 'sec-fetch-site': 'same-origin' })).status);
  }
  assert.deepEqual(statuses, Array(90).fill(200));
  assert.equal((await hit({ origin })).status, 429);
  assert.equal(stats.fetch, 0);
});

test('denied cold requests cannot populate the terrain cache', async (t) => {
  const { hit, stats, origin } = await fixture(t);
  const uncached = '-97.75000,30.27000';
  const denied = await hit({ 'sec-fetch-site': 'cross-site' }, uncached);
  assert.equal(denied.status, 403);
  assert.equal(stats.fetch, 0);
  assert.equal(stats.read, 0);
  const allowed = await hit({ origin }, uncached);
  assert.equal(allowed.status, 200);
  assert.equal(stats.fetch, 1);
});
