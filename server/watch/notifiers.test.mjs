import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createNtfyNotifier, createKdeConnectNotifier } from './notifiers.js';
import { createWatchSources } from './sources.js';

test('ntfy POST uses bounded typed message, server-side auth and source click', async (t) => {
  const received = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, auth: req.headers.authorization, value: JSON.parse(Buffer.concat(chunks)) });
    res.writeHead(200); res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const notifier = createNtfyNotifier({ server: `http://127.0.0.1:${server.address().port}`, topic: 'gev-test', token: 'private-test' });
  await notifier.send({ title: 'GEV TEST', message: 'Synthetic USGS observation', url: 'https://earthquake.usgs.gov/' });
  assert.deepEqual(received, [{ method: 'POST', auth: 'Bearer private-test', value: { topic: 'gev-test', title: 'GEV TEST', message: 'Synthetic USGS observation', click: 'https://earthquake.usgs.gov/', tags: ['globe_with_meridians'] } }]);
});
test('ntfy rejects unsafe configuration and redacts uncertain network errors', async () => {
  for (const server of ['http://public.example', 'https://user:secret@example.org', 'https://example.org/?token=secret'])
    assert.throws(() => createNtfyNotifier({ server, topic: 'test' }));
  assert.throws(() => createNtfyNotifier({ server: 'https://example.org', topic: '../secret' }));
  const notifier = createNtfyNotifier({ server: 'https://example.org', topic: 'test', fetchImpl: async () => { throw new Error('private-secret'); } });
  await assert.rejects(notifier.send({ title: 'test' }), (e) => !e.message.includes('private-secret') && e.retryable !== true);
});
test('known 429/503 responses can retry without treating rejected credentials as success', async () => {
  for (const status of [401, 429, 503]) {
    const notifier = createNtfyNotifier({ server: 'https://example.org', topic: 'test', fetchImpl: async () => new Response('{}', { status }) });
    await assert.rejects(notifier.send({ title: 'test' }), (e) => e.retryable === (status !== 401));
  }
});
test('KDE transport requires explicit device and executes without a shell or discovery', async () => {
  const calls = [];
  const notifier = createKdeConnectNotifier({ deviceId: 'test-device-123', execFileImpl: async (...args) => calls.push(args) });
  await notifier.send({ title: 'GEV TEST', message: 'Synthetic only' });
  assert.equal(calls[0][0], 'kdeconnect-cli');
  assert.deepEqual(calls[0][1], ['--device', 'test-device-123', '--ping-msg', 'GEV TEST\nSynthetic only']);
  assert.equal(calls[0][2].shell, undefined);
  assert.throws(() => createKdeConnectNotifier({ deviceId: 'bad;command' }));
});
test('USGS adapter preserves source identity/time and rejects index-derived IDs', async () => {
  const feature = { type: 'Feature', id: 'test1', geometry: { type: 'Point', coordinates: [0, 0, 1] }, properties: { mag: 5, time: 100, place: 'Synthetic' } };
  const sources = createWatchSources({ fetchImpl: async () => Response.json({ features: [feature, { ...feature, id: null }] }) });
  const rows = await sources.usgs.getSnapshot();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'usgs:test1');
  assert.equal(rows[0].observedAt, 100);
});
test('FIRMS reuses existing service and rejects stale snapshots', async () => {
  let stale = true;
  const sources = createWatchSources({ firmsService: { getSnapshot: async () => ({ stale, fetchedAt: Date.now(), fires: [{ lat: 0, lon: 0, satellite: 'N', instrument: 'VIIRS', acqDate: '2026-10-23', acqTime: '45', frp: 10, confidence: 'h' }] }) } });
  await assert.rejects(sources.firms.getSnapshot());
  stale = false;
  const [row] = await sources.firms.getSnapshot();
  assert.equal(row.observedAt, Date.UTC(2026, 9, 23, 0, 45));
  assert.equal(row.frp, 10);
  assert.equal(row.magnitude, undefined);
});
test('pre-connect failures retry while resets and aborts remain ambiguous', async () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET']) {
    const notifier = createNtfyNotifier({ server: 'https://example.org', topic: 'test', fetchImpl: async () => { throw Object.assign(new TypeError('private transport detail'), { cause: { code } }); } });
    await assert.rejects(notifier.send({ title: 'test' }), (error) => !error.message.includes('private transport detail') && (code === 'ECONNRESET' ? error.retryable === undefined : error.retryable === true));
  }
});
