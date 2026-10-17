// Regression for quanticsoul4772's #881 review. No live NASA request is made.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createThumbnailLoader } from './thumbnails.js';

const box = { west: -100, east: -99.9, south: 35, north: 35.1 };
const candidate = (day) => ({ product: 'VIIRS', day, key: `VIIRS:${day}` });
const a = candidate('2026-09-28');
const b = candidate('2026-09-29');
const sensingTime = '2026-09-28T12:00:00Z';
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = () => ({
  ok: true,
  headers: new Headers({
    'Data-Present': 'true',
    'Acquisition-Time': sensingTime,
  }),
  blob: async () => new Blob(['fixture']),
});

async function primedRefetch(t) {
  const calls = [];
  let objectId = 0;
  const loader = createThumbnailLoader({
    maxInFlight: 1,
    maxDecoded: 1,
    createObjectUrl: () => `blob:fixture-${++objectId}`,
    revokeObjectUrl: () => {},
    fetchImpl: (url, { signal }) => {
      const call = { url, signal, aborts: 0 };
      calls.push(call);
      signal.addEventListener('abort', () => { call.aborts += 1; });
      if (calls.length <= 2) return Promise.resolve(response());
      return new Promise((resolve) => { call.resolve = resolve; });
    },
  });
  t.after(() => {
    loader.destroy();
    for (const call of calls) call.resolve?.(response());
  });
  loader.request(a, box);
  await settle();
  loader.request(b, box);
  await settle();
  assert.equal(loader.get(a.key).status, 'present');
  assert.equal(loader.get(a.key).objectUrl, null, 'A was LRU-evicted');
  loader.request(a, box);
  assert.equal(calls.length, 3);
  assert.equal(loader.get(a.key).loading, true);
  return { loader, calls };
}

test('retain counts a pending refetch cancellation once', async (t) => {
  const { loader, calls } = await primedRefetch(t);
  loader.retain([b.key]);
  loader.retain([b.key]);
  loader.retain([]);
  assert.equal(calls[2].aborts, 1);
  assert.equal(loader.refinementStats().supersededInFlight, 1);
  assert.equal(loader.get(a.key).status, 'present');
  assert.equal(loader.get(a.key).acquisitionTime, sensingTime);
});

test('retain does not recount cancelAll as a supersession', async (t) => {
  const { loader, calls } = await primedRefetch(t);
  loader.cancelAll();
  loader.retain([]);
  assert.equal(calls[2].aborts, 1);
  assert.equal(loader.refinementStats().supersededInFlight, 0);
});

test('separate refetches each contribute one cancellation', async (t) => {
  const { loader, calls } = await primedRefetch(t);
  loader.retain([]);
  calls[2].resolve(response());
  await settle();
  loader.request(a, box);
  assert.equal(calls.length, 4);
  loader.retain([]);
  loader.retain([]);
  assert.equal(calls[3].aborts, 1);
  assert.equal(loader.refinementStats().supersededInFlight, 2);
});

test('wanted work remains active and uncounted', async (t) => {
  const { loader, calls } = await primedRefetch(t);
  loader.retain([a.key]);
  loader.retain([a.key]);
  assert.equal(calls[2].signal.aborted, false);
  assert.deepEqual(loader.refinementStats(), {
    supersededQueued: 0,
    supersededInFlight: 0,
  });
});

test('reentrant retain from an abort event stays idempotent', async (t) => {
  const { loader, calls } = await primedRefetch(t);
  calls[2].signal.addEventListener('abort', () => loader.retain([]));
  loader.retain([]);
  assert.equal(calls[2].aborts, 1);
  assert.equal(loader.refinementStats().supersededInFlight, 1);
});

test('queued successors wait for the cancelled transport to settle', async (t) => {
  const { loader, calls } = await primedRefetch(t);
  const c = candidate('2026-09-30');
  loader.request(c, box);
  loader.retain([c.key]);
  loader.retain([c.key]);
  assert.equal(calls.length, 3, 'no premature extra transport');
  assert.equal(loader.stats().inFlight, 1);
  calls[2].resolve(response());
  await settle();
  assert.equal(calls.length, 4);
  assert.equal(calls[3].signal.aborted, false);
  assert.equal(loader.get(a.key).objectUrl, null);
  assert.equal(loader.get(a.key).acquisitionTime, sensingTime);
});
