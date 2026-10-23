import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWatchRuntime } from './runtime.js';
import { createWatchStore } from './store.js';

const epoch = Date.UTC(2026, 9, 23, 12);
const rule = { id: 'hazards', source: 'usgs', enabled: true, lat: 0, lon: 0, radiusKm: 200, minMagnitude: 4, maxAgeMs: 3600000, cooldownMs: 0 };
const event = { id: 'usgs:test-1', source: 'USGS', observedAt: epoch - 1000, lat: 0, lon: 0, magnitude: 5, title: 'Synthetic earthquake', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/test-1' };
async function fixture(t, opts = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gev-watch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sent = [];
  let clock = epoch;
  let rows = [event];
  const store = createWatchStore(path.join(dir, 'state.json'));
  const options = { rules: [rule], store, now: () => clock, sources: { usgs: { intervalMs: 1000, getSnapshot: async () => rows } }, notifier: { send: async (msg) => { sent.push(msg); } }, ...opts };
  const runtime = await createWatchRuntime(options);
  t.after(() => runtime.close());
  return { runtime, sent, store, options, dir, advance: (ms) => { clock += ms; }, rows: (r) => { rows = r; } };
}
test('a matching event is durable, source stamped, delivered once across restart', async (t) => {
  const f = await fixture(t);
  await f.runtime.tick();
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].message, /USGS/);
  assert.equal(f.runtime.getState().events[0].observedAt, event.observedAt);
  await f.runtime.close();
  const restarted = await createWatchRuntime(f.options);
  t.after(() => restarted.close());
  f.advance(2000);
  await restarted.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(restarted.getState().events[0].status, 'delivered');
  assert.equal((await readFile(path.join(f.dir, 'state.json'), 'utf8')).includes('hazards'), true);
});
test('disabled rules cause no source requests; multiple rules share one acquisition', async (t) => {
  let requests = 0;
  const f = await fixture(t, { rules: [{ ...rule, enabled: false }], sources: { usgs: { intervalMs: 1000, getSnapshot: async () => { requests++; return [event]; } } } });
  await f.runtime.tick();
  assert.equal(requests, 0);
  await f.runtime.setRuleEnabled('hazards', true);
  await f.runtime.tick();
  assert.equal(requests, 1);
  assert.equal(f.sent.length, 1);
  await assert.rejects(f.runtime.setRuleEnabled('missing', true));
  await assert.rejects(f.runtime.setRuleEnabled('hazards', 'true'));
});
test('missing identity/time, stale, future, low severity and outside-area events cannot notify', async (t) => {
  const f = await fixture(t);
  f.rows([{ ...event, id: null }, { ...event, id: 'missing-source', source: null }, { ...event, id: 'missing-time', observedAt: null }, { ...event, id: 'stale', observedAt: epoch - 7200000 }, { ...event, id: 'future', observedAt: epoch + 1 }, { ...event, id: 'small', magnitude: 3 }, { ...event, id: 'far', lat: 40 }]);
  await f.runtime.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.runtime.getState().events.length, 0);
});
test('quiet hours defer delivery; pause prevents a queued notification', async (t) => {
  const f = await fixture(t, { rules: [{ ...rule, quietHours: { start: 12, end: 13 } }] });
  await f.runtime.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(f.runtime.getState().events[0].status, 'queued');
  await f.runtime.setRuleEnabled('hazards', false);
  f.advance(3600000);
  await f.runtime.tick();
  assert.equal(f.sent.length, 0);
});
test('cooldown limits delivery and retains deferred event identity', async (t) => {
  const f = await fixture(t, { rules: [{ ...rule, cooldownMs: 10000 }] });
  f.rows([event, { ...event, id: 'usgs:test-2' }]);
  await f.runtime.tick();
  assert.equal(f.sent.length, 1);
  f.advance(11000);
  await f.runtime.tick();
  assert.equal(f.sent.length, 2);
});
test('provider failure is unavailable, not fresh or an empty valid snapshot', async (t) => {
  const f = await fixture(t, { sources: { usgs: { intervalMs: 1000, getSnapshot: async () => { throw new Error('private-provider-token'); } } } });
  await f.runtime.tick();
  assert.equal(f.runtime.getState().sources.usgs.status, 'unavailable');
  assert.equal(f.sent.length, 0);
  assert.equal(JSON.stringify(f.runtime.getState()).includes('private-provider-token'), false);
});
test('known rejected delivery retries; ambiguous interrupted delivery never silently resends', async (t) => {
  let attempts = 0;
  const f = await fixture(t, { notifier: { send: async () => { attempts++; if (attempts === 1) throw Object.assign(new Error('HTTP503'), { retryable: true }); } } });
  await f.runtime.tick();
  assert.equal(f.runtime.getState().events[0].status, 'retry');
  f.advance(61000);
  await f.runtime.tick();
  assert.equal(attempts, 2);
  assert.equal(f.runtime.getState().events[0].status, 'delivered');
  const g = await fixture(t, { notifier: { send: async () => { throw new Error('network uncertain'); } } });
  await g.runtime.tick();
  assert.equal(g.runtime.getState().events[0].status, 'uncertain');
  g.advance(61000);
  await g.runtime.tick();
  assert.equal(g.runtime.getState().events[0].attempts, 1);
});
test('concurrent ticks serialize acquisition and delivery; persisted pause survives restart', async (t) => {
  const f = await fixture(t);
  await Promise.all([f.runtime.tick(), f.runtime.tick(), f.runtime.tick()]);
  assert.equal(f.sent.length, 1);
  await f.runtime.setRuleEnabled('hazards', false);
  await f.runtime.close();
  const restarted = await createWatchRuntime(f.options);
  t.after(() => restarted.close());
  assert.equal(restarted.getState().rules[0].enabled, false);
});
test('invalid geographic/rule input is rejected rather than coerced', async (t) => {
  for (const change of [{ lat: null }, { lon: '0' }, { radiusKm: -1 }, { maxAgeMs: Infinity }, { source: 'unknown' }, { quietHours: { start: 25, end: 1 } }]) {
    await assert.rejects(fixture(t, { rules: [{ ...rule, ...change }] }));
  }
});
test('idle cadence ticks perform no redundant durable writes', async (t) => {
  const f = await fixture(t);
  f.rows([]);
  let writes = 0;
  const save = f.store.save;
  f.store.save = async (state) => { writes++; return save(state); };
  await f.runtime.tick();
  assert.equal(writes, 1);
  await f.runtime.tick();
  await f.runtime.tick();
  assert.equal(writes, 1);
});
test('a failed durable rule change rolls back the unacknowledged memory mutation', async (t) => {
  const f = await fixture(t);
  const save = f.store.save;
  f.store.save = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.runtime.setRuleEnabled('hazards', false));
  assert.equal(f.runtime.getState().rules[0].enabled, true);
  f.store.save = save;
});
test('a changed config enabled flag overrides persisted pause in either direction', async (t) => {
  const f = await fixture(t, { rules: [{ ...rule, enabled: false }] });
  await f.runtime.close();
  const enabled = await createWatchRuntime({ ...f.options, rules: [{ ...rule, enabled: true }] });
  assert.equal(enabled.getState().rules[0].enabled, true);
  await enabled.close();
  const disabled = await createWatchRuntime({ ...f.options, rules: [{ ...rule, enabled: false }] });
  assert.equal(disabled.getState().rules[0].enabled, false);
  await disabled.close();
});
test('a pause intent prevents delivery while an in-flight source awaits completion', async (t) => {
  let release, announce;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { announce = resolve; });
  const f = await fixture(t, { sources: { usgs: { intervalMs: 1000, getSnapshot: async () => { announce(); return pending; } } } });
  const cycle = f.runtime.tick();
  await started;
  const paused = f.runtime.setRuleEnabled('hazards', false);
  release([event]);
  await Promise.all([cycle, paused]);
  assert.equal(f.sent.length, 0);
  assert.equal(f.runtime.getState().rules[0].enabled, false);
});
test('known permanent rejection is failed, not ambiguous or delivered', async (t) => {
  const f = await fixture(t, { notifier: { send: async () => { throw Object.assign(new Error('rejected'), { retryable: false }); } } });
  await f.runtime.tick();
  assert.equal(f.runtime.getState().events[0].status, 'failed');
  assert.equal(f.runtime.getState().events[0].deliveredAt, null);
});
test('expired uncertain and paused records cannot exhaust dedupe capacity forever', async () => {
  let clock = epoch;
  let saved = null;
  let rows = Array.from({ length: 1000 }, (_, i) => ({ ...event, id: `usgs:${i}` }));
  const runtime = await createWatchRuntime({
    rules: [rule], now: () => clock,
    sources: { usgs: { intervalMs: 1000, getSnapshot: async () => rows } },
    notifier: { send: async () => { throw new Error('ambiguous'); } },
    store: { load: async () => saved, save: async (state) => { saved = structuredClone(state); }, close: async () => {} },
  });
  await runtime.tick();
  assert.equal(runtime.getState().events.length, 1000);
  clock += 86400001;
  rows = [{ ...event, id: 'usgs:new', observedAt: clock }];
  await runtime.tick();
  assert.equal(runtime.getState().events.length, 1);
  assert.equal(runtime.getState().events[0].sourceId, 'usgs:new');
  await runtime.close();
});
test('partial coverage remains degraded even when a snapshot is fresh', async (t) => {
  const f = await fixture(t, { sources: { usgs: { intervalMs: 1000, getSnapshot: async () => Object.assign([], { partial: true }) } } });
  await f.runtime.tick();
  assert.equal(f.runtime.getState().sources.usgs.status, 'degraded');
});
