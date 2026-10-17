// Regression for quanticsoul4772's #844 review; fixtures do not poll cameras.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createObservedTrafficSource } from '../layers/traffic/observed.js';

let moduleId = 0;
const freshTraffic = () => import(`./traffic.js?disposal=${++moduleId}`);
const now = Date.parse('2026-10-16T12:00:00Z');
const emptySource = (name, reads) => createObservedTrafficSource({
  label: name,
  read() { reads.push(name); return { records: [] }; },
});

test('initial missing observed source is inert', async () => {
  const traffic = await freshTraffic();
  const snapshot = await traffic.refreshObservedTraffic({}, { now });
  assert.equal(snapshot.state, 'unconfigured');
  assert.equal(snapshot.configured, false);
  assert.equal(traffic.getObservedTrafficSnapshot(), snapshot);
});

test('disposed source returns to the same inert request contract', async () => {
  const traffic = await freshTraffic();
  const reads = [];
  const dispose = traffic.configureObservedTrafficSource(emptySource('A', reads));
  await traffic.refreshObservedTraffic({}, { now });
  dispose();
  const snapshot = await traffic.refreshObservedTraffic({}, { now });
  assert.equal(snapshot.state, 'unconfigured');
  assert.equal(snapshot.configured, false);
  assert.deepEqual(reads, ['A']);
  assert.equal(traffic.getObservedTrafficSnapshot(), snapshot);
});

test('obsolete disposer does not remove a replacement source', async () => {
  const traffic = await freshTraffic();
  const reads = [];
  const disposeA = traffic.configureObservedTrafficSource(emptySource('A', reads));
  const disposeB = traffic.configureObservedTrafficSource(emptySource('B', reads));
  disposeA();
  const snapshot = await traffic.refreshObservedTraffic({}, { now });
  assert.equal(snapshot.source, 'B');
  assert.deepEqual(reads, ['B']);
  disposeB();
});

test('fallback does not make malformed configured sources acceptable', async () => {
  const traffic = await freshTraffic();
  const reads = [];
  const dispose = traffic.configureObservedTrafficSource(emptySource('A', reads));
  assert.throws(() => traffic.configureObservedTrafficSource({}), TypeError);
  assert.equal((await traffic.refreshObservedTraffic({}, { now })).source, 'A');
  dispose();
});

test('a late disposed request cannot overwrite the unconfigured snapshot', async () => {
  const traffic = await freshTraffic();
  let finish;
  const dispose = traffic.configureObservedTrafficSource({
    request: () => new Promise((resolve) => { finish = resolve; }),
  });
  const pending = traffic.refreshObservedTraffic({}, { now });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  dispose();
  // Settle after the replacement no-source request takes the generation.
  try {
    const snapshot = await traffic.refreshObservedTraffic({}, { now });
    finish({ configured: true, state: 'fresh', records: [{ id: 'old' }] });
    await rejected;
    assert.equal(traffic.getObservedTrafficSnapshot(), snapshot);
    assert.equal(snapshot.state, 'unconfigured');
  } finally {
    finish({ configured: true, state: 'empty', records: [] });
    await rejected;
  }
});

test('repeated disposal remains inert without new provider calls', async () => {
  const traffic = await freshTraffic();
  const reads = [];
  const dispose = traffic.configureObservedTrafficSource(emptySource('A', reads));
  dispose();
  dispose();
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await traffic.refreshObservedTraffic({}, { now })).state, 'unconfigured');
  }
  assert.deepEqual(reads, []);
});

test('pre-aborted no-source refresh matches initial inert behavior', async () => {
  const traffic = await freshTraffic();
  const controller = new AbortController();
  controller.abort();
  const dispose = traffic.configureObservedTrafficSource(emptySource('A', []));
  dispose();
  assert.equal((await traffic.refreshObservedTraffic({}, {
    signal: controller.signal, now,
  })).state, 'unconfigured');
});
