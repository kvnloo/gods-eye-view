// Requirement: quanticsoul4772's review of upstream #881, comment 6221765171.
// Complete, SHA-verified loader/model; fetch and object URLs use public injections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailLoader } from './thumbnails.js';

const BOX = { west: -97.8, south: 30.2, east: -97.7, north: 30.3 };
const day = (n) => ({
  key: `S30:2026-09-${n}`,
  product: 'S30',
  day: `2026-09-${n}`,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, { delayedAbort = false, maxInFlight = 1 } = {}) {
  const calls = [];
  const revoked = [];
  let created = 0;
  const loader = createThumbnailLoader({
    maxDecoded: 1,
    maxInFlight,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      const call = { url, signal, resolve, reject, aborts: 0 };
      calls.push(call);
      signal.addEventListener('abort', () => {
        call.aborts += 1;
        if (!delayedAbort) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }
      });
    }),
    createObjectUrl: () => `blob:test-${++created}`,
    revokeObjectUrl: (url) => revoked.push(url),
  });
  const respond = async (index) => {
    calls[index].resolve({
      ok: true,
      headers: new Headers({
        'Data-Present': 'true',
        'Acquisition-Time': '2026-09-18T17:12:00Z',
      }),
      blob: async () => new Blob(['fixture']),
    });
    await flush();
  };
  t.after(() => {
    loader.destroy();
    for (const call of calls) call.resolve({ ok: false });
  });
  return { loader, calls, revoked, respond, created: () => created };
}

async function evictedRefetch(t, options) {
  const f = fixture(t, options);
  f.loader.request(day(10), BOX);
  await f.respond(0);
  f.loader.request(day(11), BOX);
  await f.respond(1);
  assert.equal(f.loader.get(day(10).key).objectUrl, null);
  assert.equal(f.loader.get(day(10).key).status, 'present');
  f.loader.request(day(10), BOX);
  assert.equal(f.calls.length, 3);
  return f;
}

test('known-present refetch is counted once before abort settles', async (t) => {
  const { loader, calls } = await evictedRefetch(t);
  loader.retain([]);
  loader.retain([]);
  assert.equal(calls[2].aborts, 1);
  assert.equal(loader.refinementStats().supersededInFlight, 1);
  await flush();
  assert.equal(loader.get(day(10).key).status, 'present');
  assert.equal(loader.get(day(10).key).acquisitionTime, '2026-09-18T17:12:00Z');
});

test('ignored abort cannot inflate counters or publish late pixels', async (t) => {
  const f = await evictedRefetch(t, { delayedAbort: true });
  for (let i = 0; i < 25; i += 1) f.loader.retain([]);
  assert.equal(f.calls[2].aborts, 1);
  assert.equal(f.loader.refinementStats().supersededInFlight, 1);
  await f.respond(2);
  assert.equal(f.created(), 2);
  assert.equal(f.loader.get(day(10).key).objectUrl, null);
  assert.equal(f.loader.get(day(10).key).status, 'present');
  assert.equal(f.loader.stats().inFlight, 0);
});

test('cancelAll followed by retain does not claim a superseded fetch', async (t) => {
  const { loader, calls } = await evictedRefetch(t);
  loader.cancelAll();
  loader.retain([]);
  assert.equal(calls[2].aborts, 1);
  assert.equal(loader.refinementStats().supersededInFlight, 0);
});

test('a new refetch of the same day has its own cancellation count', async (t) => {
  const { loader, calls } = await evictedRefetch(t);
  loader.retain([]);
  await flush();
  loader.request(day(10), BOX);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].signal.aborted, false);
  loader.retain([]);
  assert.equal(loader.refinementStats().supersededInFlight, 2);
});

test('wanted refetch is not cancelled or counted', async (t) => {
  const f = await evictedRefetch(t);
  f.loader.retain([day(10).key]);
  f.loader.retain([day(10).key]);
  assert.equal(f.calls[2].signal.aborted, false);
  assert.equal(f.loader.refinementStats().supersededInFlight, 0);
  await f.respond(2);
  assert.equal(f.loader.get(day(10).key).objectUrl, 'blob:test-3');
});

test('unknown inflight and queued work each count once', async (t) => {
  const { loader, calls } = fixture(t);
  loader.request(day(10), BOX);
  loader.request(day(11), BOX);
  loader.request(day(12), BOX);
  loader.retain([day(12).key]);
  loader.retain([day(12).key]);
  assert.deepEqual(loader.refinementStats(), {
    supersededQueued: 1,
    supersededInFlight: 1,
  });
  await flush();
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /TIME=2026-09-12/);
  assert.equal(calls[1].signal.aborted, false);
});
