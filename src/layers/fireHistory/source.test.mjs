import assert from 'node:assert/strict';
import test from 'node:test';

import { createFireHistorySource } from './source.js';

const EVENT = {
  id: 'camp-fire-2018',
  name: 'Camp Fire',
  startDate: '2018-11-08',
  endDate: '2018-11-25',
};

function json(payload, init = {}) {
  return Response.json(payload, init);
}

test('catalog lists only the server-reviewed event registry shape', async () => {
  const calls = [];
  const source = createFireHistorySource({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return json({
        hasKey: true,
        events: [EVENT],
      });
    },
  });

  assert.deepEqual(await source.listEvents(), {
    hasKey: true,
    events: [EVENT],
  });
  assert.equal(calls[0].url, '/api/fire-history');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('one event snapshot is bounded to the requested registered id', async () => {
  const source = createFireHistorySource({
    fetchImpl: async (url) => {
      assert.equal(url, '/api/fire-history/camp-fire-2018');
      return json({
        event: EVENT,
        fetchedAt: 1_800_000_000_000,
        complete: false,
        windows: [{ source: 'VIIRS_SNPP_SP', ok: true }],
        count: 999,
        fires: [{ lat: 39.7, lon: -121.6 }],
      });
    },
  });

  assert.deepEqual(await source.getEvent('camp-fire-2018'), {
    event: EVENT,
    fetchedAt: 1_800_000_000_000,
    complete: false,
    windows: [{ source: 'VIIRS_SNPP_SP', ok: true }],
    count: 1,
    fires: [{ lat: 39.7, lon: -121.6 }],
  });
});

test('missing FIRMS key is an explicit capability state, not a generic failure', async () => {
  const source = createFireHistorySource({
    fetchImpl: async () =>
      json({ error: 'no_key' }, { status: 503 }),
  });

  assert.deepEqual(await source.getEvent('camp-fire-2018'), {
    keyRequired: true,
    eventId: 'camp-fire-2018',
  });
});

test('malformed catalogs and snapshots fail before a layer can adopt them', async () => {
  let response = json({ hasKey: true, events: [{ id: 'BAD ID', name: 'Bad' }] });
  let source = createFireHistorySource({ fetchImpl: async () => response });
  await assert.rejects(source.listEvents(), /Malformed fire-history catalog/);

  response = json({
    event: { ...EVENT, id: 'lahaina-2023' },
    fetchedAt: Date.now(),
    complete: true,
    windows: [],
    fires: [],
  });
  source = createFireHistorySource({ fetchImpl: async () => response });
  await assert.rejects(
    source.getEvent('camp-fire-2018'),
    /Malformed fire-history snapshot/,
  );

  response = json({
    event: EVENT,
    fetchedAt: Date.now(),
    complete: 'yes',
    windows: [],
    fires: [],
  });
  source = createFireHistorySource({ fetchImpl: async () => response });
  await assert.rejects(
    source.getEvent('camp-fire-2018'),
    /Malformed fire-history snapshot/,
  );
});

test('invalid event ids never reach fetch', async () => {
  let calls = 0;
  const source = createFireHistorySource({
    fetchImpl: async () => {
      calls++;
      return json({});
    },
  });

  await assert.rejects(source.getEvent('../etc/passwd'), /valid historical fire event id/);
  await assert.rejects(source.getEvent(''), /valid historical fire event id/);
  assert.equal(calls, 0);
});

test('oversized archive responses are rejected by the portable source', async () => {
  const source = createFireHistorySource({
    fetchImpl: async () =>
      new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(33 * 1024 * 1024) },
      }),
  });

  await assert.rejects(
    source.getEvent('camp-fire-2018'),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
});

test('abort before request prevents acquisition', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const source = createFireHistorySource({
    fetchImpl: async () => {
      calls++;
      return json({ hasKey: false, events: [] });
    },
  });

  await assert.rejects(source.listEvents({ signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(calls, 0);
});
